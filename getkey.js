import { WiseKey } from 'wisekey';
import  os  from 'os';

const wisekey = await WiseKey.init('bbq');
const value = await wisekey.get('DATA_KEY');


console.log(os.homedir());
console.log(value);
