// The Kurami fox drawn as neon tubes: the Paper mark's contours as glowing lines (head red, mask
// orange-red, cheeks yellow). One source for the Neon header logo and the Neon PWA icons.
// Geometry is the PWA master (kurami-fox-pwa-master-v3.svg, 1000×1000).
export const FOX_CONTOURS={
  head:"M221 59Q180 59 180 100V422Q180 452 158 476L72 547Q55 569 72 596L444 926Q470 944 500 944Q530 944 556 926L928 596Q945 569 928 547L842 476Q820 452 820 422V100Q820 59 779 59Q761 59 747 76L562 260H438L253 76Q239 59 221 59Z",
  mask:"M260 193 340 274Q292 294 260 329ZM740 193 660 274Q708 294 740 329ZM427 336H573C614 336 645 345 668 372L762 480 650 535C578 571 540 635 540 702V829L508 854Q500 861 492 854L460 829V702C460 635 422 571 350 535L238 480 332 372C355 345 386 336 427 336Z",
  cheeks:"M182 543 307 604C331 616 355 643 369 676C376 690 379 702 379 715V760L158 572ZM815 543 840 572 617 760V711C618 685 630 658 648 639C660 625 674 614 688 605Z",
} as const;
export const NEON_FOX_COLORS={head:"#ff2233",mask:"#ff5c3c",cheeks:"#ffd23f"} as const;

/**
 * Tube widths and glow are in master units, so a small header mark uses thicker tubes than a 512 px icon.
 * `padding` leaves room for the glow inside the drawing; `background` fills the square (PWA icons only).
 */
export function neonFoxSvg(options:{tube:number;blur:number;padding:number;glow?:number;background?:string}):string {
  const {tube,blur,padding}=options,size=1000+padding*2,glow=options.glow??1;
  const stroke=(path:string,color:string,width:number)=>`<path fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round" d="${path}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-padding} ${-padding} ${size} ${size}" width="${size}" height="${size}">`
    +`<defs><filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${blur}"/><feComponentTransfer result="b"><feFuncA type="linear" slope="${glow}"/></feComponentTransfer><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`
    +(options.background?`<rect x="${-padding}" y="${-padding}" width="${size}" height="${size}" fill="${options.background}"/>`:"")
    +`<g filter="url(#glow)">${stroke(FOX_CONTOURS.head,NEON_FOX_COLORS.head,tube)}${stroke(FOX_CONTOURS.mask,NEON_FOX_COLORS.mask,tube*.72)}${stroke(FOX_CONTOURS.cheeks,NEON_FOX_COLORS.cheeks,tube*.62)}</g></svg>`;
}

/**
 * The header mark: thick tubes that stay crisp at 36–48 px with a faint glow; NEON_CSS breathes a brighter
 * one around it. It is inline markup, not an image: the apps' CSP (img-src 'self') blocks data: images.
 */
export const NEON_FOX_HEADER_SVG=neonFoxSvg({tube:60,blur:4,padding:60,glow:.5})
  .replace(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" (viewBox="[^"]+") width="\d+" height="\d+">/,'<svg class="site-brand__fox site-brand__fox--neon" $1 width="48" height="48" aria-hidden="true" focusable="false">')
  .replaceAll('id="glow"','id="kurami-neon-fox-glow"').replaceAll('url(#glow)','url(#kurami-neon-fox-glow)');
