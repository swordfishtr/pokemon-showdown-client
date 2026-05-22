/*
wget \
--recursive \
--no-clobber \
--adjust-extension \
--reject="*.html" \
--restrict-file-names=windows \
--domains play.pokemonshowdown.com \
--no-parent \
--exclude-directories="/sprites/afd,/sprites/afd-back,/sprites/afd-back-shiny,/sprites/afd-shiny,/sprites/digimon,/sprites/digimon-backup-2021-11-22" \
https://play.pokemonshowdown.com/sprites/
*/

// cd play.pokemonshowdown.com
// diff -rq sprites spritesnew > diff

// for uploading:
// (in sprites) tar -czvf .../play.pokemonshowdown.com/sprites.tar.gz *
// scp sprites.tar.gz .../play.pokemonshowdown.com/spritesnew/
// (in spritesnew) tar -xzvf sprites.tar.gz .

const fs = require('fs');

const showignore = process.argv.includes('i');
const showmove = process.argv.includes('m');
const go = process.argv.includes('go');
function ignore(msg) {
	if (showignore) {
		console.log(msg);
	}
}
function move(msg) {
	if (showmove) {
		console.log(msg);
	}
}
function commitmove(src, dest, force) {
	if (go) {
		const mode = force ? undefined : fs.constants.COPYFILE_EXCL;
		fs.copyFileSync(src, dest, mode);
	}
}

const diff = fs.readFileSync('diff', { encoding: 'utf-8' });

for (const line of diff.split('\n')) {
	if (!line.includes('.')) {
		ignore(`Ignoring directory: ${line}`);
		continue;
	}
	if (line.startsWith('Files ') && line.endsWith(' differ')) {
		const [left, right] = line.slice(6, -7).split(' and ');
		if (!left.startsWith('sprites/') || !right.startsWith('spritesnew/')) {
			ignore(`Ignoring wrong side: ${line}`);
			continue;
		}
		move(`Moving: ${right} -> ${left}`);
		commitmove(right, left, true);
		continue;
	}
	if (line.startsWith('Only in spritesnew/')) {
		const sprite = line.slice(8).split(': ', 2).join('/');
		const dest = `sprites/${line.slice(19)}`.split(': ', 2).join('/');
		move(`Moving: ${sprite} -> ${dest}`);
		commitmove(sprite, dest, false);
		continue;
	}
	ignore(`Ignoring: ${line}`);
}
