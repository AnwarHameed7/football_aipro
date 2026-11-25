# Football AI Pro mobile

This folder contains the source for the phone-friendly ChatGPT Sites app, including video review, playback coaching, the selected-player outline, team tracking, training plans, and the private review library.

## Build and test

From this folder, use Node.js 24 or later:

```sh
node scripts/build.mjs
node scripts/test.mjs
```

The build generates the Sites Worker at `dist/server/index.js`. The test suite exercises the tracking and coaching calculations, match statistics, body outlines, and review access control. The browser downloads the pose and object detection models when analysis first runs.

The deployment template declares an R2 binding named `BUCKET`. For a separate deployment, use your own ChatGPT Sites project identity and configure its access policy. Store `LIBRARY_OWNER_EMAIL` in the Site’s environment settings if you need to identify the owner of reviews from a release that predates per-review ownership. Runtime configuration and saved reviews live outside this source tree.
