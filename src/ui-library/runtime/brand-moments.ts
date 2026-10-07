/** Small brand moments, one detail at a time: the dot in "Kurami." follows the season (a snowflake in December
 * and January, a leaf in October), the fox wears a party hat on Kurami's birthday (the first commit,
 * 16 August), and on the page the brand already links to, five quick taps on the fox make it sneeze. The
 * season is set on <html> as data-brand-moment; everything visible is CSS in BRAND_MOMENTS_CSS. */
export const BRAND_BIRTHDAY = "08-16";

export function brandMoment(date: Date): "birthday" | "winter" | "autumn" | null {
  const month = date.getMonth() + 1, day = `${String(month).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return day === BRAND_BIRTHDAY ? "birthday" : month === 12 || month === 1 ? "winter" : month === 10 ? "autumn" : null;
}

export const BRAND_MOMENTS_RUNTIME_JS = `(()=>{
  const moment=(${brandMoment.toString().replace(/BRAND_BIRTHDAY/g, JSON.stringify(BRAND_BIRTHDAY))})(new Date());
  if(moment)document.documentElement.dataset.brandMoment=moment;
  let taps=[];
  document.addEventListener('click',event=>{
    const fox=event.target instanceof Element?event.target.closest('.site-brand__fox'):null;
    const brand=fox?.closest('a.site-brand');
    if(!brand||new URL(brand.href,location.href).pathname!==location.pathname)return;
    event.preventDefault();
    const now=Date.now();taps=[...taps.filter(at=>now-at<2000),now];
    if(taps.length<5)return;
    taps=[];brand.classList.remove('ui-sneeze');void brand.offsetWidth;brand.classList.add('ui-sneeze');
    brand.querySelector('.site-brand__name')?.classList.add('ui-glitch');
    setTimeout(()=>{brand.classList.remove('ui-sneeze');brand.querySelector('.site-brand__name')?.classList.remove('ui-glitch');},900);
  });
})();`;

export const BRAND_MOMENTS_CSS = `
html[data-brand-moment="winter"] .site-brand__dot, html[data-brand-moment="autumn"] .site-brand__dot { font-size: 0; }
html[data-brand-moment="winter"] .site-brand__dot::after { content: "\\2744\\FE0E"; font-size: 1.1rem; margin-inline-start: 2px; vertical-align: .15em; }
html[data-brand-moment="autumn"] .site-brand__dot::after { content: ""; display: inline-block; font-size: 1rem; width: .42em; height: .42em; margin-inline: 2px 1px; background: currentColor; border-radius: 0 100% 0 100%; rotate: -25deg; vertical-align: .02em; }
html[data-brand-moment="birthday"] .site-brand { position: relative; }
html[data-brand-moment="birthday"] .site-brand::before { content: ""; position: absolute; inset-inline-start: 15px; top: -9px; width: 16px; height: 16px; z-index: 1; pointer-events: none;
  background: var(--accent-primary); clip-path: polygon(50% 0, 100% 100%, 0 100%); rotate: -14deg; }
.site-brand.ui-sneeze .site-brand__fox { animation: kurami-fox-sneeze .6s ease-in-out; transform-origin: 50% 80%; }
@keyframes kurami-fox-sneeze { 0%, 100% { rotate: 0deg; } 30% { rotate: -6deg; } 55% { rotate: 4deg; scale: .96; } 75% { rotate: -2deg; } }
@media (prefers-reduced-motion: reduce) { .site-brand.ui-sneeze .site-brand__fox { animation: none; } }
`;
