import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";

export class ContentAddressedStore {
  constructor(root) {
    this.root = root;
  }

  async initialize() {
    await mkdir(this.root, { recursive: true });
  }

  pathFor(key) {
    if (!/^[a-f0-9]{64}$/.test(key)) {
      throw new Error("invalid content key");
    }
    return path.join(this.root, `${key}.json`);
  }

  async has(key) {
    try {
      await readFile(this.pathFor(key));
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }

  async get(key) {
    const raw = await readFile(this.pathFor(key), "utf8");
    return JSON.parse(raw);
  }

  async put(key, artifact) {
    const target = this.pathFor(key);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(artifact), "utf8");
    await rename(temporary, target);
  }

  async clear() {
    await rm(this.root, { recursive: true, force: true });
    await this.initialize();
  }

  async count() {
    try {
      const files = await readdir(this.root);
      return files.filter((file) => file.endsWith(".json")).length;
    } catch (error) {
      if (error.code === "ENOENT") return 0;
      throw error;
    }
  }
}
