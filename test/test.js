import { WiseKey } from '../dist/src/WiseKey.js';

async function main() {
  try {
    const wisekey = await WiseKey.init('ruby');

    // Retrieve the required keys
    const apmSecret = await wisekey.get('APM_SECRET');
    const apmServerUrl = await wisekey.get('APM_SERVER_URL');
    const apmEnvironment = await wisekey.get('APM_ENVIRONMENT');

    console.log('Keys retrieved successfully:');
    console.log('APM_SECRET:', apmSecret);
    console.log('APM_SERVER_URL:', apmServerUrl);
    console.log('APM_ENVIRONMENT:', apmEnvironment);
  } catch (error) {
    console.error('Error retrieving keys:', error.message);
    process.exit(1);
  }
}

main();
