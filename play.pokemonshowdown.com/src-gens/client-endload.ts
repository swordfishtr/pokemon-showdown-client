import { PS } from "./client-main";

PS.libsLoaded.loaded();

if(window.DragDropTouch) {
	window.DragDropTouch.enable(undefined, undefined, {
		isPressHoldMode: true,
	});
}

if(PS.prefs.showdex) {
	const script = document.createElement('script');
	script.src = 'showdex-gens/main.js';
	document.body.appendChild(script);
}
