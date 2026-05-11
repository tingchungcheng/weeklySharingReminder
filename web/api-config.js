// Amplify preBuild overwrites from env (see amplify.yml).
// Local: set remote API URL; EDIT key = SAM EditRosterSecret.
//
// If the browser shows "Failed to fetch" while using a local server, either:
//   (1) sam deploy (OPTIONS /roster CORS fix), or
//   (2) set WEEKLY_SHARING_DEV_API_PROXY = true and run:
//       python3 sam/scripts/dev_http_server.py
//       (use PORT=8099 if 8080 is already taken: PORT=8099 python3 sam/scripts/dev_http_server.py)

window.WEEKLY_SHARING_DEV_API_PROXY = false;

(function () {
  const remote = "https://aic25c4d4j.execute-api.ap-southeast-1.amazonaws.com";
  const useProxy =
    typeof window !== "undefined" &&
    window.WEEKLY_SHARING_DEV_API_PROXY === true &&
    typeof location !== "undefined" &&
    location.protocol !== "file:";
  window.WEEKLY_SHARING_API_BASE = useProxy
    ? `${location.origin}/__weekly_api`
    : remote;
})();

/** Same value as SAM `EditRosterSecret` — sent as X-Edit-Key on PUT /roster. */
window.WEEKLY_SHARING_EDIT_KEY = "N3gKkaLbQvvWWywSliNoHKsNjb7ts5VZxNXLvIUq6qU=";

/** Person on the first Wednesday (SERIES_START); schedule is A→Z then rotated so this name is week 0. */
window.WEEKLY_SHARING_SERIES_ANCHOR_NAME = "Pang Yong Xian";
