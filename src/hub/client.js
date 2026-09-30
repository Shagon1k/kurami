const dashboard=document.getElementById("hub-dashboard");
let refreshing=false;
async function refreshHub(){
  if(!dashboard||refreshing||document.visibilityState!=="visible"||dashboard.contains(document.activeElement))return;
  refreshing=true;
  try {
    const response=await fetch("/api/fragment",{cache:"no-store",credentials:"same-origin"});
    if(!response.ok)throw new Error("Hub refresh failed");
    const html=await response.text();
    if(dashboard.innerHTML!==html)dashboard.innerHTML=html;
    dashboard.removeAttribute("data-disconnected");
  } catch {
    dashboard.setAttribute("data-disconnected","true");
    const status=dashboard.querySelector(".hub__live");
    if(status)status.textContent="Нет связи · последние данные";
  }
  finally {refreshing=false;}
}
setInterval(refreshHub,60_000);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")void refreshHub();});
if("serviceWorker" in navigator)window.addEventListener("load",()=>{void navigator.serviceWorker.register("/sw.js").catch(()=>{});});
