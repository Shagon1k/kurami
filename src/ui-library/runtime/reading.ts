/** Shared read-only cues: desktop Docs location and one-shot anchor arrival. */
function kuramiReadingRuntime(){
  const mount=()=>{
    let frame=0,arrival:HTMLElement|null=null,clearTimer:ReturnType<typeof setTimeout>|undefined;
    function destination(href:string){
      try{const url=new URL(href,location.href);return url.origin===location.origin&&url.pathname===location.pathname&&url.search===location.search&&url.hash?document.getElementById(decodeURIComponent(url.hash.slice(1))):null;}catch{return null;}
    }
    function highlight(target:HTMLElement|null){
      const heading=target?.matches('h1,h2,h3,h4')?target:target?.querySelector<HTMLElement>('h1,h2,h3,h4');
      if(!heading||!heading.closest('main')||!heading.getClientRects().length)return;
      if(arrival===heading)return;
      if(arrival)delete arrival.dataset.anchorArrival;clearTimeout(clearTimer);arrival=heading;heading.dataset.anchorArrival='true';
      clearTimer=setTimeout(()=>{if(arrival)delete arrival.dataset.anchorArrival;arrival=null;},1800);
    }
    function reading(){
      frame=0;
      const nav=document.querySelector('.toc');if(!nav||!nav.getClientRects().length)return;
      const links=[...nav.querySelectorAll<HTMLAnchorElement>('a[href]')];
      const targets=links.map(link=>({link,heading:destination(link.href)})).filter(item=>item.heading?.getClientRects().length);
      if(!targets.length)return;
      let current=targets[0]!;for(const item of targets)if(item.heading!.getBoundingClientRect().top<=Math.min(160,innerHeight*.25))current=item;
      if(scrollY>0&&scrollY+innerHeight>=document.documentElement.scrollHeight-2)current=targets.at(-1)!;
      for(const link of links)if(link===current.link)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');
    }
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(reading);};
    addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule);
    document.addEventListener('click',event=>{
      if(!(event.target instanceof Element)||event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
      const link=event.target.closest<HTMLAnchorElement>('a[href]');if(!link||link.target==='_blank'||link.hasAttribute('download')||link.closest('.mobile-navigation'))return;
      const target=destination(link.href);if(target)setTimeout(()=>{if(!event.defaultPrevented)highlight(target);},350);
    });
    document.addEventListener('kurami:anchor-arrival',event=>highlight(document.getElementById((event as CustomEvent<string>).detail)));
    addEventListener('hashchange',()=>{highlight(destination(location.href));schedule();});
    addEventListener('pageshow',schedule);
    const main=document.querySelector('main');if(main)new MutationObserver(schedule).observe(main,{childList:true,subtree:true});
    reading();if(location.hash)highlight(destination(location.href));
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
}
export const READING_RUNTIME_JS=`(${kuramiReadingRuntime.toString()})();`;
