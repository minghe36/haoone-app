const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function captureSubtitleError(value, stage, log) {
    const error = value instanceof Error ? value : new Error(String(value));
    if (!error.subtitleStage) error.subtitleStage = stage;
    try {
        log('Subtitle operation failed: stage=' + error.subtitleStage + ' error=' + error.message);
    } catch (_) {
        // Reporting must not replace the original native error or escape cleanup.
    }
    return error;
}

function timelineItems(value) {
    if (Array.isArray(value)) return value.filter(item => item && (typeof item === 'object' || typeof item === 'function'));
    if (!value || typeof value !== 'object') return [];
    return Object.keys(value).filter(key => /^\d+$/.test(key))
        .sort((a, b) => Number(a) - Number(b))
        .map(key => value[key]).filter(item => item && (typeof item === 'object' || typeof item === 'function'));
}

// Read every subtitle track: raw SRT append may choose a different track or
// create another track. An existing caption must never confirm this request.
async function readSubtitleTracks(timeline, log = () => {}) {
    const count = await timeline.GetTrackCount('subtitle');
    if (!Number.isInteger(count) || count < 0) throw new Error('Invalid subtitle track count');
    const tracks = [];
    for (let index = 1; index <= count; index++) {
        const items = timelineItems(await timeline.GetItemListInTrack('subtitle', index));
        const ids = [];
        for (const item of items) {
            if (typeof item.GetUniqueId === 'function') {
                const id = await item.GetUniqueId();
                if (typeof id === 'string' && id.trim()) ids.push(id);
            }
        }
        const name = await timeline.GetTrackName('subtitle', index);
        log('Subtitle track snapshot: index=' + index + ' name=' + name + ' items=' + items.length);
        tracks.push({ index, name, items, ids });
    }
    return tracks;
}

function findInsertedSubtitles(before, after) {
    const previousIds = new Set(before.flatMap(track => track.ids));
    const identitiesAvailable = before.every(track => track.ids.length === track.items.length);
    return after.map(track => {
        let inserted = 0;
        if (identitiesAvailable && track.ids.length === track.items.length) {
            inserted = track.ids.filter(id => !previousIds.has(id)).length;
        } else {
            // Older bridges without item IDs can use counts only when the track
            // layout is unchanged. Never mistake a shifted old track for an import.
            const previous = before.find(value => value.index === track.index && value.name === track.name);
            if (before.length === after.length && previous) inserted = Math.max(0, track.items.length - previous.items.length);
        }
        return { trackIndex: track.index, inserted };
    }).filter(track => track.inserted > 0);
}

// Subtitle media must not receive ordinary video trim fields: Resolve 21
// aborts in GetMediaFrameExtentsWithFrameRate when startFrame/endFrame are set.
async function appendSubtitleToTrack(mediaPool, mediaPoolItem, trackIndex) {
    if (!Number.isInteger(trackIndex) || trackIndex < 1) throw new Error('Invalid subtitle track index');
    return await mediaPool.AppendToTimeline([{ mediaPoolItem, trackIndex }]);
}
// Match haoone.lua's Resolve 20/21 SRT origin workaround. Only the single
// newly-added temporary cue may be deleted; never clear an existing track.
async function prepareSubtitlePosition({ timeline, importItem,
    fileSystem = fs, tempDirectory = os.tmpdir(), wait, log = () => {} }) {
    const before = await readSubtitleTracks(timeline, log);
    if (before.some(track => track.ids.length !== track.items.length)) {
        throw new Error('Cannot identify existing subtitles before position preparation');
    }
    const previousIds = new Set(before.flatMap(track => track.ids));
    const directory = fileSystem.mkdtempSync(path.join(tempDirectory, 'haoone-subtitle-position-'));
    const temporaryPath = path.join(directory, 'position.srt');
    fileSystem.writeFileSync(temporaryPath, '1\n00:00:00,000 --> 00:00:01,000\ntemp\n', 'utf8');
    let media;
    let prepared = false;
    let stage = 'temporary-media-import';
    try {
        log('native stage=PrepareSubtitlePosition status=begin');
        media = await importItem(temporaryPath);
        if (!media || typeof media.appendRaw !== 'function') {
            throw new Error('Cannot import temporary subtitle media');
        }
        await wait(100);
        stage = 'temporary-append';
        const result = await media.appendRaw();
        if (!result || (Array.isArray(result) && timelineItems(result).length === 0)) {
            throw new Error('Cannot append temporary subtitle for position preparation');
        }
        stage = 'temporary-enumeration';
        let temporaryItems = [];
        for (let attempt = 0; attempt < 20; attempt++) {
            await wait(200);
            const tracks = await readSubtitleTracks(timeline, log);
            temporaryItems = [];
            for (const track of tracks) {
                if (track.ids.length !== track.items.length) {
                    throw new Error('Cannot identify temporary subtitle');
                }
                for (let index = 0; index < track.items.length; index++) {
                    if (!previousIds.has(track.ids[index])) temporaryItems.push(track.items[index]);
                }
            }
            if (temporaryItems.length) break;
        }
        if (temporaryItems.length !== 1) throw new Error('Cannot isolate temporary subtitle for position preparation');
        stage = 'temporary-delete';
        log('native stage=DeleteTemporarySubtitle status=begin');
        if (!await timeline.DeleteClips(temporaryItems, false)) {
            throw new Error('Cannot remove temporary subtitle for position preparation');
        }
        log('native stage=DeleteTemporarySubtitle status=end');
        await wait(200);
        stage = 'temporary-verification';
        const remaining = await readSubtitleTracks(timeline, log);
        const remainingIds = new Set(remaining.flatMap(track => track.ids));
        if (remaining.some(track => track.ids.length !== track.items.length)
            || remainingIds.size !== previousIds.size
            || [...previousIds].some(id => !remainingIds.has(id))) {
            throw new Error('Subtitle position preparation changed existing subtitles');
        }
        prepared = true;
        log('native stage=PrepareSubtitlePosition status=end');
    } catch (error) {
        throw captureSubtitleError(error, stage, log);
    } finally {
        // Keep the source file when media-pool deletion fails, avoiding an offline
        // reference. Cleanup never deletes timeline tracks or existing captions.
        try {
            if (!media || (prepared && typeof media.dispose === 'function' && await media.dispose())) {
                fileSystem.unlinkSync(temporaryPath);
                fileSystem.rmdirSync(directory);
            }
        } catch (error) {
            captureSubtitleError(error, 'temporary-media-cleanup', log);
        }
    }
}

function createSubtitleImporter({ getTimeline, importItem, fileSystem = fs,
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)), log = () => {},
    preparePosition = prepareSubtitlePosition }) {
    let busy = false;
    async function executeImportSubtitles(params = {}) {
        const filePath = params.filePath || params.subtitleFilePath || params.file_path;
        if (typeof filePath !== 'string' || !path.isAbsolute(filePath)
            || path.extname(filePath).toLowerCase() !== '.srt') {
            throw new Error('Expected an absolute SRT filePath');
        }
        if (!fileSystem.statSync(filePath).isFile()) throw new Error('Subtitle path is not a file');
        if (busy) throw new Error('Subtitle import is already running');
        busy = true;
        let timeline;
        let trackIndex;
        let stage = 'timeline';
        const restoreTrackStates = [];
        try {
            timeline = await getTimeline();
            if (!timeline) throw new Error('No current timeline');
            if (params.timelineId && String(await timeline.GetUniqueId()) !== params.timelineId) {
                throw new Error('Current timeline changed before subtitle import');
            }
            const previousCount = await timeline.GetTrackCount('subtitle');
            if (!Number.isInteger(previousCount) || previousCount < 0) throw new Error('Invalid subtitle track count');
            if (params.replace) {
                for (let index = 1; index <= previousCount; index++) {
                    if (await timeline.GetIsTrackEnabled('subtitle', index)) {
                        trackIndex = index;
                        break;
                    }
                }
            }
            const reusingTrack = trackIndex !== undefined;
            if (!reusingTrack) {
                // Existing subtitle tracks: insert at a valid explicit position rather
                // than the default end iterator that crashed Resolve's QList::insert.
                const options = previousCount > 0 ? { index: 1 } : null;
                stage = 'create-track';
                log('native stage=AddSubtitleTrack status=begin previousCount=' + previousCount
                    + ' index=1 explicit=' + Boolean(options));
                const created = options
                    ? await timeline.AddTrack('subtitle', options)
                    : await timeline.AddTrack('subtitle');
                if (!created) throw new Error('Cannot create subtitle track');
                log('native stage=AddSubtitleTrack status=end');
                await wait(200);
                const currentCount = await timeline.GetTrackCount('subtitle');
                if (currentCount !== previousCount + 1) throw new Error('Cannot identify new subtitle track');
                trackIndex = 1;
                const name = await timeline.GetTrackName('subtitle', trackIndex);
                if (typeof name !== 'string' || !name.trim()) throw new Error('Cannot confirm new subtitle track name');
                log('Subtitle track created: ' + trackIndex + ' name=' + name + ' (previous count: ' + previousCount + ')');
            }
            // Resolve may leave a new track disabled after previous tracks were
            // removed. Activate only this new track before raw SRT append.
            stage = 'enable-track';
            log('native stage=EnableNewSubtitleTrack status=begin trackIndex=' + trackIndex);
            if (!await timeline.GetIsTrackEnabled('subtitle', trackIndex)) {
                const enabled = await timeline.SetTrackEnable('subtitle', trackIndex, true);
                await wait(200);
                if (!enabled || !await timeline.GetIsTrackEnabled('subtitle', trackIndex)) {
                    throw new Error('Cannot enable new subtitle track');
                }
            }
            log('native stage=EnableNewSubtitleTrack status=end');
            // Raw SRT import chooses an enabled subtitle track. Isolate the new
            // destination so another enabled track cannot receive this language.
            stage = 'isolate-track';
            const destinationCount = await timeline.GetTrackCount('subtitle');
            for (let index = 1; index <= destinationCount; index++) {
                if (index === trackIndex) continue;
                const enabled = await timeline.GetIsTrackEnabled('subtitle', index);
                if (enabled) {
                    restoreTrackStates.push(index);
                    if (!await timeline.SetTrackEnable('subtitle', index, false)
                        || await timeline.GetIsTrackEnabled('subtitle', index)) {
                        throw new Error('Cannot isolate subtitle destination');
                    }
                }
            }
            stage = 'prepare-position';
            await preparePosition({ timeline, importItem, fileSystem, wait, log });
            stage = 'import-media';
            log('native stage=ImportSubtitleMedia status=begin');
            const item = await importItem(filePath);
            log('native stage=ImportSubtitleMedia status=end');
            if (!item) throw new Error('Cannot import subtitle file into media pool');
            await wait(100);
            if (params.replace && reusingTrack) {
                stage = 'clear-existing-subtitles';
                const oldItems = timelineItems(await timeline.GetItemListInTrack('subtitle', trackIndex));
                if (oldItems.length && !await timeline.DeleteClips(oldItems, false)) {
                    throw new Error('Cannot clear current subtitle track');
                }
                await wait(200);
                if (timelineItems(await timeline.GetItemListInTrack('subtitle', trackIndex)).length) {
                    throw new Error('Old subtitles remain on current subtitle track');
                }
                log('Cleared current subtitle track ' + trackIndex + ': ' + oldItems.length + ' items');
            }
            const beforeAppend = await readSubtitleTracks(timeline, log);
            stage = 'append';
            log('native stage=AppendSubtitles status=begin trackIndex=' + trackIndex + ' mode=haoone-srt');
            // Resolve ignores recordFrame for subtitle clip-info objects and appends
            // them at the timeline end. Raw SRT import preserves cue positions.
            const appended = typeof item.appendRaw === 'function'
                ? await item.appendRaw() : await item.append(trackIndex);
            log('native stage=AppendSubtitles status=end');
            log('Subtitle append primitive values: ' + JSON.stringify(Array.isArray(appended)
                ? appended.filter(value => value === null || !['object', 'function'].includes(typeof value)) : []));
            if (!appended || (Array.isArray(appended) && timelineItems(appended).length === 0)) {
                throw new Error('Cannot append subtitle file to timeline');
            }
            log('Subtitle append result: array=' + Array.isArray(appended) + ' handles=' + timelineItems(appended).length
                + ' types=' + (Array.isArray(appended) ? appended.map(value => value === null ? 'null' : typeof value).join(',') : typeof appended));
            stage = 'verify';
            let insertedTracks = [];
            for (let attempt = 0; attempt < 20; attempt++) {
                await wait(200);
                try {
                    const tracks = await readSubtitleTracks(timeline, log);
                    insertedTracks = findInsertedSubtitles(beforeAppend, tracks);
                } catch (error) {
                    throw new Error('Cannot verify subtitle track: ' + String(error));
                }
                if (insertedTracks.length > 0) break;
            }
            if (insertedTracks.length === 0) {
                throw new Error('No new subtitles found on any subtitle track after import');
            }
            if (insertedTracks.length !== 1) throw new Error('Subtitle import changed multiple subtitle tracks');
            if (insertedTracks[0].trackIndex !== trackIndex) {
                throw new Error('Subtitles were inserted on a different track');
            }
            trackIndex = insertedTracks[0].trackIndex;
            const inserted = insertedTracks[0].inserted;
            log('Subtitle import confirmed on track ' + trackIndex + ': ' + inserted
                + ' items (confirmation: track list)');
            return { ok: true, trackIndex, inserted, filePath };
        } catch (error) {
            throw captureSubtitleError(error, stage, log);
        } finally {
            // Do not mutate Resolve's timeline/undo history during error cleanup.
            // A failed append can leave native state pending; preserve even empty
            // newly-created tracks rather than calling DeleteTrack automatically.
            for (const index of restoreTrackStates) {
                try {
                    if (!await timeline.SetTrackEnable('subtitle', index, true)) log('Cannot restore subtitle track state: ' + index);
                } catch (error) { log('Cannot restore subtitle track state: ' + index + ' ' + String(error)); }
            }
            busy = false;
        }
    }
    return async function importSubtitles(params = {}) {
        try {
            return await executeImportSubtitles(params);
        } catch (error) {
            // Include validation/filesystem errors which happen before locking.
            if (error instanceof Error && error.subtitleStage) throw error;
            throw captureSubtitleError(error, 'validation', log);
        }
    };
}

module.exports = { createSubtitleImporter, appendSubtitleToTrack, timelineItems, readSubtitleTracks, findInsertedSubtitles, prepareSubtitlePosition };
