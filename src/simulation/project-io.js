// A project may include an explicit CAD tetrahedral mesh. Bound the encoded
// text before parsing, while allowing the workbench's own pretty JSON exports.
export const PROJECT_TEXT_LIMIT_BYTES=16*1024*1024;
export function parseProjectText(text){
  if(typeof text!=='string'||!text.trim())throw Error('项目 JSON 不能为空');
  // Every UTF-8 encoded code point uses at least as many bytes as UTF-16 units.
  // This first bound avoids allocating another huge buffer for excessive input.
  if(text.length>PROJECT_TEXT_LIMIT_BYTES||new TextEncoder().encode(text).byteLength>PROJECT_TEXT_LIMIT_BYTES)throw Error('项目 JSON 超过 16 MiB，请减少网格或部件数量');
  let project;
  try{project=JSON.parse(text.charCodeAt(0)===0xfeff?text.slice(1):text);}catch{throw Error('项目 JSON 格式无效，请检查括号、逗号和引号');}
  if(!project||typeof project!=='object'||Array.isArray(project))throw Error('项目 JSON 须为模型对象');
  // Schema, references, material ranges and mesh topology remain the selected
  // solver's responsibility; parsing never commits a document or simulation.
  return project;
}
