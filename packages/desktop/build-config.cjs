const config=structuredClone(require('./package.json').build);
const signed=Boolean(process.env.CSC_LINK);
const notarized=Boolean(process.env.APPLE_ID&&process.env.APPLE_APP_SPECIFIC_PASSWORD&&process.env.APPLE_TEAM_ID);
if(process.platform==='darwin'&&signed){
  delete config.mac.identity;
  config.mac.forceCodeSigning=true;
  config.mac.notarize=notarized;
}
config.extraMetadata={studyMacUpdates:process.platform==='darwin'&&signed&&notarized};
module.exports=config;
