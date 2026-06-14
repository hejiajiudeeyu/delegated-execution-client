import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function removePath(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function packageTargetDir(nodeModulesDir, packageName) {
  return path.join(nodeModulesDir, ...packageName.split("/"));
}

function copyDir(sourceDir, targetDir) {
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    force: true,
    dereference: true,
    filter(source) {
      const relative = path.relative(sourceDir, source);
      if (!relative) {
        return true;
      }
      const firstSegment = relative.split(path.sep)[0];
      if (["node_modules", ".git", "coverage", "dist"].includes(firstSegment)) {
        return false;
      }
      return true;
    }
  });
}

function collectWorkspacePackageDirs() {
  const packageDirs = [];
  for (const baseDir of ["apps", "packages"]) {
    const absoluteBaseDir = path.join(ROOT_DIR, baseDir);
    if (!fs.existsSync(absoluteBaseDir)) {
      continue;
    }
    for (const entry of fs.readdirSync(absoluteBaseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const directPackageJson = path.join(absoluteBaseDir, entry.name, "package.json");
      if (fs.existsSync(directPackageJson)) {
        packageDirs.push(path.join(absoluteBaseDir, entry.name));
        continue;
      }
      for (const nested of fs.readdirSync(path.join(absoluteBaseDir, entry.name), { withFileTypes: true })) {
        if (!nested.isDirectory()) {
          continue;
        }
        const nestedPackageJson = path.join(absoluteBaseDir, entry.name, nested.name, "package.json");
        if (fs.existsSync(nestedPackageJson)) {
          packageDirs.push(path.join(absoluteBaseDir, entry.name, nested.name));
        }
      }
    }
  }
  return packageDirs;
}

function workspacePackageIndex() {
  const index = new Map();
  for (const packageDir of collectWorkspacePackageDirs()) {
    const manifest = readJson(path.join(packageDir, "package.json"));
    if (manifest.name) {
      index.set(manifest.name, {
        dir: packageDir,
        manifest
      });
    }
  }
  return index;
}

function resolveInstalledPackageDir(packageName, fromDir = ROOT_DIR) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`, {
    paths: [fromDir, ROOT_DIR]
  });
  return path.dirname(packageJsonPath);
}

function dependencyNames(manifest) {
  return [
    ...Object.keys(manifest.dependencies || {}),
    ...Object.keys(manifest.optionalDependencies || {})
  ];
}

function sanitizeBundledWorkspaceManifest(packageDir) {
  const packageJsonPath = path.join(packageDir, "package.json");
  const manifest = readJson(packageJsonPath);
  delete manifest.dependencies;
  delete manifest.devDependencies;
  delete manifest.optionalDependencies;
  delete manifest.peerDependencies;
  writeJson(packageJsonPath, manifest);
}

function stageInstalledPackageClosure(
  packageName,
  nodeModulesDir,
  staged,
  visited = new Set(),
  fromDir = ROOT_DIR,
  sourceDirOverride = null
) {
  if (visited.has(packageName)) {
    return;
  }
  visited.add(packageName);

  const sourceDir = sourceDirOverride || resolveInstalledPackageDir(packageName, fromDir);
  const manifest = readJson(path.join(sourceDir, "package.json"));
  const dependencyTargetDir = packageTargetDir(nodeModulesDir, packageName);
  ensureDir(path.dirname(dependencyTargetDir));
  removePath(dependencyTargetDir);
  copyDir(sourceDir, dependencyTargetDir);
  staged.push(dependencyTargetDir);

  for (const dependencyName of dependencyNames(manifest)) {
    stageInstalledPackageClosure(dependencyName, nodeModulesDir, staged, visited, sourceDir);
  }
}

function stageBinLinks(nodeModulesDir, staged) {
  const binDir = path.join(nodeModulesDir, ".bin");
  ensureDir(binDir);
  for (const packageDir of staged) {
    const packageJsonPath = path.join(packageDir, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      continue;
    }
    const manifest = readJson(packageJsonPath);
    const binEntries =
      typeof manifest.bin === "string"
        ? [[manifest.name.split("/").pop(), manifest.bin]]
        : Object.entries(manifest.bin || {});
    for (const [binName, relativeBinPath] of binEntries) {
      const linkPath = path.join(binDir, binName);
      removePath(linkPath);
      fs.symlinkSync(path.relative(binDir, path.join(packageDir, relativeBinPath)), linkPath);
    }
  }
}

function resolveTargetDir() {
  const relativeTarget = process.argv[3] || "apps/ops";
  return path.resolve(ROOT_DIR, relativeTarget);
}

function buildTargetPaths(targetDir) {
  const stagedNodeModulesDir = path.join(targetDir, "node_modules");
  const stageMarker = path.join(stagedNodeModulesDir, ".workspace-bundle-stage.json");
  return {
    targetDir,
    stagedNodeModulesDir,
    stageMarker
  };
}

function stageBundledWorkspaces(targetDir) {
  const targetManifest = readJson(path.join(targetDir, "package.json"));
  const bundledDependencies = Array.isArray(targetManifest.bundleDependencies) ? targetManifest.bundleDependencies : [];
  const workspaceIndex = workspacePackageIndex();
  const bundlePlan = bundledDependencies.map((packageName) => {
    const workspacePackage = workspaceIndex.get(packageName);
    return {
      packageName,
      workspacePackage,
      sourceDir: workspacePackage ? null : resolveInstalledPackageDir(packageName, targetDir)
    };
  });
  const staged = [];
  const { stagedNodeModulesDir, stageMarker } = buildTargetPaths(targetDir);

  removePath(stagedNodeModulesDir);

  for (const { packageName, workspacePackage, sourceDir } of bundlePlan) {
    if (workspacePackage) {
      const dependencyTargetDir = packageTargetDir(stagedNodeModulesDir, packageName);
      ensureDir(path.dirname(dependencyTargetDir));
      removePath(dependencyTargetDir);
      copyDir(workspacePackage.dir, dependencyTargetDir);
      sanitizeBundledWorkspaceManifest(dependencyTargetDir);
      staged.push(dependencyTargetDir);
    } else {
      stageInstalledPackageClosure(packageName, stagedNodeModulesDir, staged, new Set(), targetDir, sourceDir);
    }
  }

  stageBinLinks(stagedNodeModulesDir, staged);

  writeJson(stageMarker, {
    staged_at: new Date().toISOString(),
    staged
  });

  return staged;
}

function cleanupBundledWorkspaces(targetDir) {
  const { stagedNodeModulesDir, stageMarker } = buildTargetPaths(targetDir);
  if (!fs.existsSync(stageMarker)) {
    return;
  }
  const marker = readJson(stageMarker);
  for (const stagedPath of marker.staged || []) {
    if (typeof stagedPath === "string" && stagedPath.startsWith(stagedNodeModulesDir)) {
      removePath(stagedPath);
    }
  }
  removePath(stageMarker);
  if (fs.existsSync(stagedNodeModulesDir) && fs.readdirSync(stagedNodeModulesDir).length === 0) {
    removePath(stagedNodeModulesDir);
  }
}

const action = process.argv[2] || "stage";
const targetDir = resolveTargetDir();
if (action === "stage") {
  stageBundledWorkspaces(targetDir);
} else if (action === "cleanup") {
  cleanupBundledWorkspaces(targetDir);
} else {
  throw new Error(`unsupported_bundle_workspace_action:${action}`);
}
