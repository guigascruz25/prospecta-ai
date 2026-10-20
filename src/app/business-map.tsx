'use client';
import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
import type { Lead } from '../db/schema';
import type { LeadSource } from '../features/discovery';

export type MapCompany={lead:Lead;source:LeadSource};
export function BusinessMap({items,selectedId,onSelect,geography}:{geography:string;items:MapCompany[];selectedId:string;onSelect:(id:string)=>void}) {
  const container=useRef<HTMLDivElement>(null);
  const map=useRef<LeafletMap|null>(null);
  const group=useRef<LayerGroup|null>(null);
  const select=useRef(onSelect);
  useEffect(()=>{select.current=onSelect;},[onSelect]);
  const [ready,setReady]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{
    let cancelled=false;
    void import('leaflet').then(L=>{
      if(cancelled || !container.current) return;
      const instance=L.map(container.current,{scrollWheelZoom:false}).setView([-14.2,-51.9],4);
      map.current=instance;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(instance).on('tileerror',()=>setError('Algumas imagens do mapa não carregaram. A lista e os contextos continuam disponíveis.'));
      group.current=L.layerGroup().addTo(instance);setReady(true);
    });
    return ()=>{cancelled=true;map.current?.remove();map.current=null;group.current=null;};
  },[]);
  const points=JSON.stringify(items.filter(item=>item.source.latitude!==null&&item.source.longitude!==null).map(item=>({id:item.lead.id,name:item.lead.name,lat:item.source.latitude,lon:item.source.longitude,verified:item.source.verified})));
  useEffect(()=>{
    if(!ready) return;
    let cancelled=false;
    void import('leaflet').then(L=>{
      if(cancelled || !group.current) return;
      group.current.clearLayers();
      for(const point of JSON.parse(points) as {id:string;name:string;lat:number;lon:number;verified:number}[]) {
        const popup=document.createElement('div');popup.textContent=point.name+' · localização aproximada';
        const marker=L.circleMarker([point.lat,point.lon],{radius:point.id===selectedId?11:8,color:'#fff',weight:2,fillColor:point.verified?'#72904e':'#d98a5b',fillOpacity:0.95}).bindTooltip(popup).addTo(group.current);
        marker.on('click',()=>select.current(point.id));
      }
    });
    return ()=>{cancelled=true;};
  },[points,selectedId,ready]);
  const selected=items.find(item=>item.lead.id===selectedId)?.source;
  const lat=selected?.latitude,lon=selected?.longitude;
  useEffect(()=>{if(ready&&lat!==null&&lat!==undefined&&lon!==null&&lon!==undefined) map.current?.setView([lat,lon],15);},[lat,lon,ready]);
  return <div className="capture-map-wrap"><div ref={container} className="capture-map" role="region" aria-label={`Mapa de empresas em ${geography || "sua região"}`}/><div className="map-caption"><strong>{geography || "Região a configurar"}</strong><span>Pontos aproximados de endereços encontrados. Empresas sem endereço aparecem na lista.</span></div>{error&&<p className="map-error">{error}</p>}</div>;
}
