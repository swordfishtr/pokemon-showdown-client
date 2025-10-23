import { PS } from "./client-main";

PS.libsLoaded.loaded();

if(window.DragDropTouch) {
	console.log('Polyfill DragDropTouch');
	window.DragDropTouch.enable();
}

if(PS.prefs.showdex) {
	const script = document.createElement('script');
	script.src = 'showdex-gens/main.js';
	document.body.appendChild(script);
}
