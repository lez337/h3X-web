import {suppliedCountries} from './country';
export default function CountryBadge({fields}:{fields:unknown}){
 const codes=suppliedCountries(fields);
 if(!codes.length)return null;
 return <span className="country-badges">{codes.map(code=><span className="country-badge" key={code} title={new Intl.DisplayNames(['en'],{type:'region'}).of(code)} aria-label={`Country: ${code}`}><b>{code}</b></span>)}</span>;
}
