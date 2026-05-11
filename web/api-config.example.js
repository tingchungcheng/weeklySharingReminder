// Copy to web/api-config.js for local development.
// Amplify preBuild overwrites web/api-config.js from environment variables.

window.WEEKLY_SHARING_DEV_API_PROXY = false;

(function () {
  const remote = "https://YOUR_API_ID.execute-api.ap-southeast-1.amazonaws.com";
  const useProxy =
    typeof window !== "undefined" &&
    window.WEEKLY_SHARING_DEV_API_PROXY === true &&
    typeof location !== "undefined" &&
    location.protocol !== "file:";
  window.WEEKLY_SHARING_API_BASE = useProxy
    ? `${location.origin}/__weekly_api`
    : remote;
})();

/** Cognito config for custom auth modal (from SAM outputs / Amplify env). */
window.WEEKLY_SHARING_COGNITO_DOMAIN =
  "https://YOUR_PREFIX.auth.ap-southeast-1.amazoncognito.com";
window.WEEKLY_SHARING_COGNITO_CLIENT_ID = "YOUR_COGNITO_CLIENT_ID";
window.WEEKLY_SHARING_COGNITO_REGION = "ap-southeast-1";

/** Person on the first Wednesday (SERIES_START); schedule is A→Z then rotated so this name is week 0. */
window.WEEKLY_SHARING_SERIES_ANCHOR_NAME = "Pang Yong Xian";
