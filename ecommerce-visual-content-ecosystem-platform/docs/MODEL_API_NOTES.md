# Volcengine Ark integration notes

Verified against current public Ark documentation on 2026-09-23.

Default models:

- `deepseek-v4-pro`
- `doubao-seed-2-1-turbo-260628`
- `doubao-seed-2-1-pro-260628`
- `doubao-seedream-5-0-pro-260628`
- `doubao-seedance-2-5-260628`

Official references:

- Quick start / base URL: https://docs.volcengine.com/docs/ark/2536046?lang=zh
- Chat API: https://docs.volcengine.com/docs/ark/chat-api?lang=zh
- Model release list: https://docs.volcengine.com/docs/ark/model-release-announcement?lang=zh
- Video API: https://docs.volcengine.com/docs/ark/video-generation-api?lang=zh
- API Key console: https://ark.volcengine.com/region:cn-beijing/apikey

The Web settings page deliberately allows model IDs to be replaced without modifying source code because Ark model aliases/versioned IDs can evolve.

## Seedance 2.5 reference image contract

For the MVP product-ad path, generated product imagery is passed as a flexible subject/reference image rather than a strict first frame. The request therefore sets `content.role = reference_image`. This preserves the selected `9:16` output ratio. A strict `first_frame`/`last_frame` workflow would instead require the corresponding role and adaptive ratio handling.
