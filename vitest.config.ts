import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin, vitestExecArgv } from './packages/runtime/vitest.shared.ts'
export default defineConfig({
  plugins:[standardDecoratorPlugin(),tsconfigPaths({projects:['./tsconfig.json']})],
  test:{execArgv:vitestExecArgv,testTimeout:30000,include:[
    'packages/runtime/modules/core/tools/tests/{tools,execution-mode}.spec.ts',
    'packages/runtime/modules/core/agent-loop/tests/resume.spec.ts',
    'packages/runtime/modules/extensions/cordis-host-runner/tests/versioning.spec.ts',
    'packages/runtime/modules/boot/plugin-manager/tests/package-reload.spec.ts',
    'packages/runtime/modules/test-support/agent-loop-testkit/tests/study-*.spec.ts',
  ]},
})
