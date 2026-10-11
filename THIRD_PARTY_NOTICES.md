# 第三方代码与许可说明

本项目有取舍地采用 DeepSeek Harness 的实现。版权和许可继续归原作者；合并代码不改变这些许可，也不表示本项目由原作者维护。

## 纳入仓库的源代码

- DeepSeek Harness：MIT，来源版本 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`。完整许可保存在 [packages/runtime/LICENSE](packages/runtime/LICENSE)。保留组件及来源路径见 [SOURCE.json](packages/runtime/SOURCE.json)。
- Cordis、Cosmokit、Schemastery 和 Loader/Include/Group/Timer：MIT；各自完整许可保留在 `packages/runtime/foundation/*/LICENSE`。
- 原生系统模块及 flock C 实现：BSD-3-Clause；完整许可保存在 [packages/runtime/native/system/LICENSE](packages/runtime/native/system/LICENSE)及对应子包内。
- Marked、DOMPurify、PDF.js 的现有许可保留在 `ui/lib/`。
- 剪贴板工具 [ui/clipboard.mjs](ui/clipboard.mjs)：取自同一 DeepSeek Harness 版本的 `packages/client/ui-primitives/src/clipboard.ts`，转为浏览器可直接使用的 JavaScript，保留复制失败检测与兼容回退；MIT，Copyright (c) 2026 DeepSeek，完整许可见 [packages/runtime/LICENSE](packages/runtime/LICENSE)。

采用范围：模型循环、工具管线、持久会话、附件、模型适配、持久命令执行、必要服务与定向测试。未纳入原桌面/网页产品、账户平台、Office 工具或其他无关应用。启动、源代码布局、配置组成和依赖声明由本项目维护。原内部包名保留用于稳定模块身份，不代表需要下载 DeepSeek 仓库。

## 可选录音转写

采用 [LocalTranscribe](https://github.com/zhc070307/LocalTranscribe_on_going) 的版本 `42773e1a01f8029ae2f54ae7c924cbc0451d53f3`，只保留后台音频解码、切分、Qwen ASR、原稿与断点管理；未纳入其 GUI、Qt、启动器、更新器或远程全文整理。完整 Apache-2.0 许可、修改声明和来源记录保存在 `packages/transcription/LICENSE`、`NOTICE`、`SOURCE.json`。本项目修改其流程为只产出原稿，默认优先 Metal/NVIDIA GPU，并删除自动 CPU 回退；CPU 模式需用户主动选择，PyTorch/torchaudio 按后端配套安装。

转写依赖和模型仅用户明确需要时下载，不包含在默认安装或本仓库中。Qwen3-ASR-1.7B-hf 为 Apache-2.0；PyTorch/torchaudio 为 BSD-3-Clause，Transformers 为 Apache-2.0，Silero VAD 为 MIT，PyAV 为 BSD-3-Clause，SoundFile 为 BSD-3-Clause，noisereduce 为 MIT。PyAV 和 SoundFile 的分发包可能附带 FFmpeg/libsndfile，须分别保留对应 LGPL 及其他许可；未来若再分发这些二进制，应核对实际 wheel 内的编解码库许可和源码义务。模型下载保留模型自身许可文件。

## 安装依赖

`pnpm-lock.yaml` 固定实际安装依赖。本仓库不包含 `node_modules` 或预编译原生二进制。下表记录此次核对的安装依赖许可，包括开发与检查依赖；具体版权及完整许可由各依赖包提供。

桌面安装包包含 Electron、Node.js、Python、TinyTeX、pypdfium2、Pillow、时区数据及 JavaScript 运行依赖，各组件完整许可随其目录保留。PDF 读取采用 pypdfium2 和 PDFium，不包含 PyMuPDF。TinyTeX 包中字体、宏包和排版引擎保留各自许可，不以本项目 MIT 许可替代。

Windows 包中的 TeX 可执行文件由本项目构建脚本调整应用清单，启用 UTF-8 代码页，以支持中文安装路径；原有清单信息保留。修改步骤见 `scripts/desktop-build.py`，原排版引擎源码由 [TeX Live 源码仓库](https://github.com/TeX-Live/texlive-source) 提供，各原许可继续适用。

图像依赖中的 libvips 使用 LGPL-3.0-or-later。随包保留其许可、实际组件版本和声明；对应源码及构建脚本由 [sharp-libvips v1.3.2](https://github.com/lovell/sharp-libvips/tree/v1.3.2) 提供，组件来源与版本可在该版本构建脚本和包内 `versions.json` 中核对。这些库的许可不要求将本项目自己的全部代码改为 LGPL；用户可替换安装目录中的相应共享库。MPL 依赖保留相应文件许可及上游源码地址。

| 安装依赖 | 许可 |
| --- | --- |
| `@img/sharp-linux-x64@0.35.3` | Apache-2.0 |
| `detect-libc@2.1.2` | Apache-2.0 |
| `expect-type@1.4.0` | Apache-2.0 |
| `human-signals@8.0.1` | Apache-2.0 |
| `playwright@1.58.2` | Apache-2.0 |
| `playwright-core@1.58.2` | Apache-2.0 |
| `sharp@0.35.3` | Apache-2.0 |
| `typescript@6.0.3` | Apache-2.0 |
| `diff@9.0.0` | BSD-3-Clause |
| `fast-uri@3.1.8` | BSD-3-Clause |
| `source-map-js@1.2.2` | BSD-3-Clause |
| `picocolors@1.1.1` | ISC |
| `semver@7.8.5` | ISC |
| `siginfo@2.0.0` | ISC |
| `signal-exit@4.1.0` | ISC |
| `yaml@2.9.0` | ISC |
| `@img/sharp-libvips-linux-x64@1.3.2` | LGPL-3.0-or-later |
| `@babel/code-frame@7.29.7` | MIT |
| `@babel/helper-validator-identifier@7.29.7` | MIT |
| `@esbuild/linux-x64@0.28.1` | MIT |
| `@eslint-community/regexpp@4.12.2` | MIT |
| `@img/colour@1.1.0` | MIT |
| `@jridgewell/sourcemap-codec@1.6.0` | MIT |
| `@koromix/koffi-linux-x64@3.1.1` | MIT |
| `@oxc-project/types@0.153.0` | MIT |
| `@rolldown/binding-linux-x64-gnu@1.2.13` | MIT |
| `@rolldown/pluginutils@1.0.1` | MIT |
| `@sec-ant/readable-stream@0.4.1` | MIT |
| `@sindresorhus/merge-streams@4.0.0` | MIT |
| `@standard-schema/spec@1.1.0` | MIT |
| `@types/chai@5.2.3` | MIT |
| `@types/deep-eql@4.0.2` | MIT |
| `@types/estree@1.0.9` | MIT |
| `@vitest/expect@4.1.8` | MIT |
| `@vitest/mocker@4.1.8` | MIT |
| `@vitest/pretty-format@4.1.8` | MIT |
| `@vitest/runner@4.1.8` | MIT |
| `@vitest/snapshot@4.1.8` | MIT |
| `@vitest/spy@4.1.8` | MIT |
| `@vitest/utils@4.1.8` | MIT |
| `@xterm/headless@6.0.0` | MIT |
| `ajv@8.20.0` | MIT |
| `assertion-error@2.0.1` | MIT |
| `chai@6.3.0` | MIT |
| `chokidar@4.0.3` | MIT |
| `commander@15.0.0` | MIT |
| `convert-source-map@2.0.0` | MIT |
| `debug@4.4.3` | MIT |
| `es-module-lexer@2.3.2` | MIT |
| `esbuild@0.28.1` | MIT |
| `estree-walker@3.0.3` | MIT |
| `eventsource-parser@3.1.0` | MIT |
| `execa@10.0.0` | MIT |
| `fast-deep-equal@3.1.3` | MIT |
| `fdir@6.5.0` | MIT |
| `figures@6.1.0` | MIT |
| `get-stream@9.0.1` | MIT |
| `globrex@0.1.2` | MIT |
| `is-plain-obj@4.1.0` | MIT |
| `is-stream@4.0.1` | MIT |
| `is-unicode-supported@2.1.0` | MIT |
| `js-tokens@4.0.0` | MIT |
| `js-yaml@4.3.1` | MIT |
| `json-schema-traverse@1.0.0` | MIT |
| `koffi@3.1.1` | MIT |
| `magic-string@0.30.21` | MIT |
| `ms@2.1.3` | MIT |
| `nanoid@3.3.20` | MIT |
| `node-addon-api@7.1.1` | MIT |
| `node-addon-native-custom-loader@0.1.6` | MIT |
| `node-addon-require-builtin@0.1.6` | MIT |
| `node-addon-require-builtin-linux-x64-gnu@0.1.6` | MIT |
| `node-pty@1.2.0-beta.15` | MIT |
| `npm-run-path@6.0.0` | MIT |
| `obug@2.2.1` | MIT |
| `parse-ms@4.0.0` | MIT |
| `path-key@4.0.0` | MIT |
| `pathe@2.0.3` | MIT |
| `picomatch@4.0.4, 4.0.7` | MIT |
| `postcss@8.5.29` | MIT |
| `pretty-ms@9.3.1` | MIT |
| `readdirp@4.1.2` | MIT |
| `require-from-string@2.0.2` | MIT |
| `resolve.exports@2.0.3` | MIT |
| `rolldown@1.2.13` | MIT |
| `stackback@0.0.2` | MIT |
| `std-env@4.3.0` | MIT |
| `strip-final-newline@4.0.0` | MIT |
| `tinybench@2.9.0` | MIT |
| `tinyexec@1.3.1` | MIT |
| `tinyglobby@0.2.17` | MIT |
| `tinyrainbow@3.2.0` | MIT |
| `tsconfck@3.1.6` | MIT |
| `tsx@4.22.4` | MIT |
| `undici@8.10.0` | MIT |
| `unicorn-magic@0.3.0` | MIT |
| `vite@8.3.4` | MIT |
| `vite-tsconfig-paths@6.1.1` | MIT |
| `vitest@4.1.8` | MIT |
| `which-command@0.1.0` | MIT |
| `why-is-node-running@2.3.0` | MIT |
| `yoctocolors@2.2.0` | MIT |
| `zod@4.4.3` | MIT |
| `lightningcss@1.33.0` | MPL-2.0 |
| `lightningcss-linux-x64-gnu@1.33.0` | MPL-2.0 |
| `argparse@2.0.1` | Python-2.0 |

## Native desktop components

The desktop shell uses Electron, electron-builder and electron-updater (MIT), Node.js (its bundled license), and Python (PSF License). Native PDF reading/rendering uses pypdfium2 (Apache-2.0/BSD-3-Clause), PDFium and its bundled third-party license texts, and Pillow (HPND). Time zone data uses tzdata (Apache-2.0 and public-domain IANA data). The Chinese PDF compiler redistributes a selected TeX Live/TinyTeX tree; each TeX package and font retains its license and license documents in that tree. Installation resources retain the component license texts. No PyMuPDF or other AGPL PDF library is bundled. Optional speech inference weights are fetched only on user request and remain governed by their upstream model license.
