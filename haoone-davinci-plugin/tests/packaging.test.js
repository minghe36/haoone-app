const test = require('node:test'); const assert = require('node:assert/strict');
test('release includes every static local runtime dependency and matching manifest version', () => {
 const fs=require('node:fs');const path=require('node:path');
 const root=path.join(__dirname,'..');
 const build=fs.readFileSync(path.join(root,'scripts/build.js'),'utf8');
 const include=build.split('const INCLUDE = [')[1].split('];')[0];
 const files=[...include.matchAll(/'([^']+)'/g)].map(match=>match[1]);
 for(const file of files.filter(file=>file.endsWith('.js'))) {
  const source=fs.readFileSync(path.join(root,file),'utf8');
  for(const match of source.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g)) {
   const target=path.extname(match[1])?match[1]:match[1]+'.js';
   assert(files.includes(target),`${file} requires missing ${target}`);
  }
 }
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 assert(fs.readFileSync(path.join(root,'manifest.xml'),'utf8').includes(`<Version>${pkg.version}</Version>`));
});

test('Windows helper preserves Chinese menu names under Windows PowerShell 5.1', { skip: process.platform !== 'win32' }, () => {
 const fs=require('node:fs'); const path=require('node:path'); const {execFileSync}=require('node:child_process');
 const helper=path.join(__dirname,'../windowsOgrafDestination.ps1');
 const script="$ProgressPreference='SilentlyContinue'; $text=Get-Content -Raw -LiteralPath '"+helper.replace(/'/g,"''")+"'; if (!$text.Contains('时间线') -or !$text.Contains('源轨道选择器')) { throw 'Chinese menu encoding corrupted' }; $tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseInput($text,[ref]$tokens,[ref]$errors); if ($errors.Count) { throw ($errors | Out-String) }";
 execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true});
 assert.equal(fs.readFileSync(helper).subarray(0,3).toString('hex'),'efbbbf');
});
