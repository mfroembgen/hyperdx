import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

// Preserve exact Bun dependency versions and internal links in portable output.
export async function materializeRuntimeDependencies(
  target,
  names,
  appDir,
  { excludeSourceMaps = false } = {},
) {
  const packages = new Map();
  const modulesDir = join(target, 'node_modules');
  await rm(modulesDir, { recursive: true, force: true });
  await mkdir(join(modulesDir, '.packages'), { recursive: true });

  async function packageRoot(name, from) {
    let entry;
    try {
      entry = Bun.resolveSync(`${name}/package.json`, from);
    } catch {
      entry = Bun.resolveSync(name, from);
    }
    let current = dirname(entry);
    for (;;) {
      try {
        const data = JSON.parse(
          await readFile(join(current, 'package.json'), 'utf8'),
        );
        if (typeof data.name === 'string')
          return { root: await realpath(current), data };
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      }
      const parent = dirname(current);
      if (parent === current)
        throw new Error(`Cannot find runtime package ${name} from ${from}`);
      current = parent;
    }
  }

  async function linkPackage(name, from, parentModules, optional = false) {
    let resolved;
    try {
      resolved = await packageRoot(name, from);
    } catch (error) {
      if (optional) return;
      throw error;
    }
    const { root, data } = resolved;
    let destination = packages.get(root);
    if (!destination) {
      const hash = createHash('sha256')
        .update(relative(appDir, root))
        .digest('hex')
        .slice(0, 8);
      destination = join(
        modulesDir,
        '.packages',
        `${name.replaceAll('/', '+')}@${data.version}-${hash}`,
      );
      packages.set(root, destination);
      await cp(root, destination, {
        recursive: true,
        dereference: true,
        filter: source => {
          const path = relative(root, source);
          const top = path.split(sep)[0];
          if (
            top === 'node_modules' ||
            (excludeSourceMaps && path.endsWith('.map'))
          )
            return false;
          // Workspace roots contain test reports and sources that an npm install
          // would omit. Keep their published files or the API's compiled output.
          if (!root.includes(`${sep}node_modules${sep}`)) {
            const files = (
              data.files ?? (data.name === '@hyperdx/api' ? ['build'] : null)
            )?.map(file => file.replace(/\/\*.*$/, ''));
            if (
              path &&
              files &&
              top !== 'package.json' &&
              !files.some(
                file => path === file || path.startsWith(`${file}${sep}`),
              )
            )
              return false;
          }
          return true;
        },
      });
      const dependencies = {
        ...data.peerDependencies,
        ...data.dependencies,
        ...data.optionalDependencies,
      };
      for (const dependency of Object.keys(dependencies)) {
        if (dependency.startsWith('@types/')) continue;
        const optionalDependency =
          dependency in (data.optionalDependencies ?? {}) ||
          data.peerDependenciesMeta?.[dependency]?.optional === true;
        await linkPackage(
          dependency,
          root,
          join(destination, 'node_modules'),
          optionalDependency,
        );
      }
    }
    const link = join(parentModules, name);
    await mkdir(dirname(link), { recursive: true });
    await symlink(relative(dirname(link), destination), link, 'dir');
  }

  // Preserve each package's exact Bun-resolved dependencies. Vinext's flat
  // standalone copier otherwise merges different versions under one name.
  for (const name of new Set(names)) {
    await linkPackage(name, appDir, modulesDir);
  }
}
