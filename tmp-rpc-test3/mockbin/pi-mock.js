
const fs = require('fs');
fs.writeFileSync(process.env.MOCK_ARGS_FILE, JSON.stringify(process.argv.slice(2)));
let buf='';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk=>{buf+=chunk; if(buf.includes('
')){
  process.stdout.write(JSON.stringify({type:'response',command:'prompt',success:true})+'
');
  process.stdout.write(JSON.stringify({type:'agent_end'})+'
');
  process.exit(0);
}});
