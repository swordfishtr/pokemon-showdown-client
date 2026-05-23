import { Config } from './client-core';
import { PS } from './client-main';

setTimeout(() => {
	if(window.DragDropTouch) {
		console.log('Polyfill DragDropTouch');
		window.DragDropTouch.enable(undefined, undefined, {
			isPressHoldMode: true,
		});
	}

	Config.libsLoaded.loaded();
}, 1);

// Showdex loads very slowly, so we don't count it towards `Config.libsLoaded`
if(PS.prefs.showdex) {
	const script = document.createElement('script');
	script.src = 'showdex-gens/main.js';
	document.body.appendChild(script);
}
