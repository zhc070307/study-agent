# 第三方代码与许可说明

本项目有取舍地采用 DeepSeek Harness 的实现。版权和许可继续归原作者；合并代码不改变这些许可，也不表示本项目由原作者维护。

## 纳入仓库的源代码

- DeepSeek Harness：MIT，来源版本 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`。完整许可保存在 [packages/runtime/LICENSE](packages/runtime/LICENSE)。保留组件及来源路径见 [SOURCE.json](packages/runtime/SOURCE.json)。
- Cordis、Cosmokit、Schemastery 和 Loader/Include/Group/Timer：MIT；各自完整许可保留在 `packages/runtime/foundation/*/LICENSE`。
- 原生系统模块及 flock C 实现：BSD-3-Clause；完整许可保存在 [packages/runtime/native/system/LICENSE](packages/runtime/native/system/LICENSE)及对应子包内。
- Marked、DOMPurify、PDF.js 的现有许可保留在 `ui/lib/`。

采用范围：模型循环、工具管线、持久会话、附件、模型适配、持久命令执行、必要服务与定向测试。未纳入原桌面/网页产品、账户平台、Office 工具或其他无关应用。启动、源代码布局、配置组成和依赖声明由本项目维护。原内部包名保留用于稳定模块身份，不代表需要下载 DeepSeek 仓库。

## 安装依赖

`pnpm-lock.yaml` 固定实际安装依赖。本仓库不包含 `node_modules` 或预编译原生二进制。下表记录此次核对的安装依赖许可，包括开发与检查依赖；具体版权及完整许可由各依赖包提供。

若以后发布包含依赖的安装包或镜像，应随包保留其许可与声明。图像依赖中的 libvips 使用 LGPL-3.0-or-later，需要保留该库的许可及对应源码提供方式；这些库的许可不要求将本项目自己的全部代码改为 LGPL。MPL 依赖同样须按其条款保留相应文件的许可与源码义务。当前合并的运行源码是 MIT/BSD，未将这些依赖的二进制或源码复制进本仓库。

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
