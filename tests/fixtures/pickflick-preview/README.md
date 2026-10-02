This non-secret Compose fixture is copied unchanged from PickFlick
`compose.preview.yaml` at commit `c867bbcc3d16c63130caa89a2f7e76acefdd08b2`.

`npm run test:pickflick-preview-contract` uses it by default. Pass
`-- --repository /path/to/PickFlick` or set `PICKFLICK_PREVIEW_REPOSITORY` to
inspect another checkout. The test uses the adapter's generated runtime files
and synthetic OAuth values, renders configuration without a Docker daemon,
and deletes its disposable files. It reads no repository `.env` or real secret
file. Update this fixture from a reviewed Compose contract when PickFlick changes.
