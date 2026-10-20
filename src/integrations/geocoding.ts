import { z } from 'zod';
import { sqlite } from '../db';
import { normalizeText } from '../lib/domain';

const photon=z.object({features:z.array(z.object({geometry:z.object({coordinates:z.tuple([z.number(),z.number()])}),properties:z.object({city:z.string().optional(),name:z.string().optional(),street:z.string().optional(),housenumber:z.string().optional(),osm_key:z.string().optional(),osm_value:z.string().optional(),countrycode:z.string().optional()})}))});
export type MapLocation={latitude:number;longitude:number;note:string};
export function locationFromResult(input:unknown,address:string,city:string):MapLocation|null {
  const result=photon.parse(input);
  const cleanStreet=(value:string)=>normalizeText(value).replace(/^(rua|r\.?|avenida|av\.?|praca|travessa|rodovia)\s+/,'').split(/,|\d/)[0].trim();
  const street=cleanStreet(address);
  for(const item of result.features) {
    const props=item.properties;
    const [longitude,latitude]=item.geometry.coordinates;
    if(normalizeText(props.city || '')!==normalizeText(city) || props.countrycode?.toUpperCase()!=='BR' || !Number.isFinite(latitude) || latitude<-19.2 || latitude>-18 || longitude<-47.2 || longitude>-46 || props.osm_key==='place') continue;
    const foundStreet=cleanStreet(props.street || props.name || '');
    if(street.length<4 || !foundStreet.includes(street) && !street.includes(foundStreet) || !foundStreet) continue;
    return {latitude,longitude,note:props.housenumber?'Ponto aproximado do endereço encontrado em OpenStreetMap/Photon.':'Ponto aproximado da rua; número não confirmado pelo mapa.'};
  }
  return null;
}
let lastRequest=0;
export async function geocodeAddress(address:string,city:string):Promise<MapLocation|null> {
  if(!address || normalizeText(city)!=='patos de minas') return null;
  const queryAddress=address.replace(/\bN[uú]mero\s*(\d+)/i,', $1').split(/ no Bairro| em frente| Estamos| e na esquina| CNPJ/i)[0];
  const query=`${queryAddress}, ${city}, Minas Gerais, Brasil`;
  const cached=sqlite.prepare('SELECT result FROM geocode_cache WHERE query=?').get(query) as {result:string}|undefined;
  if(cached) return JSON.parse(cached.result) as MapLocation|null;
  try {
    const delay=Math.max(0,1100-(Date.now()-lastRequest));
    if(delay) await new Promise(resolve=>setTimeout(resolve,delay));
    lastRequest=Date.now();
    const params=new URLSearchParams({q:query,limit:'3',lat:'-18.578',lon:'-46.518'});
    const response=await fetch(`https://photon.komoot.io/api/?${params}`,{headers:{'User-Agent':'VendusLocal/0.3 (local business discovery; low volume)'},signal:AbortSignal.timeout(10000)});
    if(!response.ok) return null;
    const location=locationFromResult(await response.json(),address,city);
    sqlite.prepare('INSERT OR REPLACE INTO geocode_cache VALUES (?,?,?)').run(query,JSON.stringify(location),new Date().toISOString());
    return location;
  } catch {return null;}
}
