/**
 * Detect a CSV separator from the first logical row, not the first physical
 * line. Delimiters inside quoted cells (including multi-line headers) are data.
 * This helper deliberately does not parse the file: parseDelimited validates
 * quotes and row limits after the separator is selected.
 */
export function detectCsvDelimiter(input:string):","|";" {
 const text=input.replace(/^\uFEFF/,"");
 let quoted=false,commas=0,semicolons=0;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(ch==='"'){
   if(quoted&&text[i+1]==='"'){i++;continue;}
   quoted=!quoted;
   continue;
  }
  if(quoted)continue;
  if(ch==="\r"||ch==="\n")break;
  if(ch===",")commas++;
  if(ch===";")semicolons++;
 }
 return semicolons>commas?";":",";
}
