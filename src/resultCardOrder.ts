export const cardGroups=[['people','People'],['oath','Oath account cards'],['username','Username results'],['overview','Search overview'],['sources','Sources']] as const;
export function cardOrder(value:unknown):string[]{
 const known=cardGroups.map(([id])=>id as string);
 const saved=Array.isArray(value)?value.filter((id):id is string=>typeof id==='string'&&known.includes(id)):[];
 return [...new Set([...saved,...known])];
}
