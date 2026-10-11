const config=structuredClone(require('./package.json').build);
// GitHub supplies an empty string for optional, unset signing secrets.
// The builder interprets an empty CSC_LINK as the current directory.
if(!process.env.CSC_LINK?.trim()){
  delete process.env.CSC_LINK;
  delete process.env.CSC_KEY_PASSWORD;
}
const signed=Boolean(process.env.CSC_LINK);
const notarized=Boolean(process.env.APPLE_ID&&process.env.APPLE_APP_SPECIFIC_PASSWORD&&process.env.APPLE_TEAM_ID);
if(process.platform==='darwin'&&signed){
  delete config.mac.identity;
  config.mac.forceCodeSigning=true;
  config.mac.notarize=notarized;
}
config.extraMetadata={studyMacUpdates:process.platform==='darwin'&&signed&&notarized};
module.exports=config;
