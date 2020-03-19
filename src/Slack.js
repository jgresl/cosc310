const { App } = require('@slack/bolt');
const fetch = require('node-fetch');
var lastResponse = '';

// Initializes your app with your bot token and signing secret
const app = new App({
  token: 'xoxb-755200714180-1009768874725-toSW2OiQ5jJl6vKeuULLsLPL',
  signingSecret: '50ef9ff2b498e3cb6ebc96491f64eed8'
});

(async () => {
  // Start your app
  await app.start(process.env.PORT || 16000);

  console.log('⚡️ Bolt app is running!');
})();

//Wait to be mentioned in chat
app.event('app_mention', async ({event, say}) => {
  //Get response from server
  fetch(`http://localhost:17000?input=${event.text}&lastResponse=${lastResponse}`)
    .then(response => {
      return response.text();
    })
    .then(output => {
      say(output);
      lastResponse = output;
      });
});
