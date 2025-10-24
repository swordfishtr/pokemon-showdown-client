import { PS } from './client-main';

setTimeout(() => {
	if(window.DragDropTouch) {
		console.log('Polyfill DragDropTouch');
		window.DragDropTouch.enable(undefined, undefined, {
			allowDragScroll: false,
			isPressHoldMode: true,
		});
	}

	PS.libsLoaded.loaded();
}, 0);

// Showdex loads very slowly, so we don't count it towards `PS.libsLoaded`
if(PS.prefs.showdex) {
	const script = document.createElement('script');
	script.src = 'showdex-gens/main.js';
	document.body.appendChild(script);
}
