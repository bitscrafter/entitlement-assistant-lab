/**
 * Structural rules of the rule register (AI_CONSTITUTION.md §4). Each rule name matches the register.
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: "model-has-no-io",
      comment: "A subsystem's model imports nothing outside its own model folder and the shared kernel.",
      severity: "error",
      from: { path: "^subsystem/([^/]+)/src/model/" },
      to: { pathNot: ["^subsystem/$1/src/model/", "^kernel/"] },
    },
    {
      name: "model-has-no-io",
      comment: "The shared kernel holds pure types and functions; it imports nothing outside itself.",
      severity: "error",
      from: { path: "^kernel/", pathNot: "/tests/" },
      to: { pathNot: "^kernel/" },
    },
    {
      name: "dependencies-point-inward",
      comment: "A use case never imports infrastructure, shared adapters, or third-party libraries.",
      severity: "error",
      from: { path: "^subsystem/[^/]+/src/usecase/" },
      to: { path: ["^subsystem/[^/]+/src/infra/", "^adapter/", "^external/", "^application/"] },
    },
    {
      name: "dependencies-point-inward",
      comment: "Only external/ imports third-party packages; everything else goes through it.",
      severity: "error",
      from: {
        pathNot: [
          "^external/",
          "\\.test\\.ts$",
          "^vitest\\.config\\.ts$",
          "/tests/",
          "^application/entitlement-assistant/src/ui/",
          "vite\\.config\\.ts$",
        ],
      },
      to: { dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer"] },
    },
    {
      name: "dependencies-point-inward",
      comment: "Shared ports depend on nothing but other ports.",
      severity: "error",
      from: { path: "^port/" },
      to: { pathNot: ["^port/", "^kernel/"] },
    },
    {
      name: "dependencies-point-inward",
      comment:
        "Shared adapters satisfy ports with external libraries; they know no subsystem or application.",
      severity: "error",
      from: { path: "^adapter/" },
      to: { path: ["^subsystem/", "^application/"] },
    },
    {
      name: "dependencies-point-inward",
      comment: "Only the application wires everything; subsystems never import it.",
      severity: "error",
      from: { path: "^subsystem/" },
      to: { path: "^application/" },
    },
    {
      name: "subsystems-meet-through-use-cases",
      comment: "A subsystem reaches another only through its public use cases, never its model or infra.",
      severity: "error",
      from: { path: "^subsystem/([^/]+)/" },
      to: { path: "^subsystem/([^/]+)/src/(model|infra)/", pathNot: "^subsystem/$1/" },
    },
    {
      name: "dependencies-point-inward",
      comment: "The browser UI is its own program: it talks to the server only over HTTP, never by import.",
      severity: "error",
      from: { path: "^application/entitlement-assistant/src/ui/" },
      to: { pathNot: ["^application/entitlement-assistant/src/ui/"], dependencyTypesNot: ["npm", "npm-dev"] },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: ["\\.wrangler", "ui-dist"] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { extensions: [".ts", ".tsx", ".js"] },
  },
};
