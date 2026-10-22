export type CategorySuggestion = {key:string;score:number;reason?:string};

export function chooseAutomaticCategory(suggestions:CategorySuggestion[]):string|null {
  const ranked=[...suggestions].filter(item=>item.key&&Number.isFinite(item.score))
    .sort((a,b)=>b.score-a.score);
  const best=ranked[0];
  if(!best||best.score<5)return null;
  if(ranked[1]&&best.score-ranked[1].score<2)return null;
  return best.key;
}
