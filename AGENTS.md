# GLB Viewer 项目约定

## 项目用途

本项目是独立的本地 GLB 预览工具，使用 Vite、Three.js 和原生 JavaScript。页面通过浏览器选择本机文件或文件夹中的 GLB，兼容 `EXT_meshopt_compression`。可用于查看 `glbcreater` 的输出，不依赖其代码或资源。

## 目录与命名

- `index.html` 是唯一页面入口，CSS 在 `<head>` 中通过 `<link>` 加载。
- `favicon.svg` 放在项目根目录，作为页面标签图标。
- `public/favicon.png` 由根目录的 `favicon.svg` 转换生成，仅用于 Open Graph 图片；修改 SVG 后同步重新生成 PNG。
- `src/glb-preview.js` 管理列表、模型加载、相机和渲染；`src/glb-preview.css` 管理页面样式。
- `tools/glb-preview-server.js` 为本地 Vite 服务提供只读目录扫描和文件读取接口；同目录 `.test.js` 验证接口行为。
- `README.md` 说明安装、运行、功能及与 `glbcreater` 的配合；`.gitignore` 排除依赖和构建产物。
- 源文件和目录使用小写英文、连字符命名。不要将测试 GLB、业务模型或用户文件复制进仓库。

## 修改与验证

- 目录服务只接受本机同源只读访问，跳过符号链接；不得添加写入或删除用户模型的操作。
- 不依赖 Caker Design 的资源、接口或代理，不修改 `glbcreater` 项目。
- 修改后运行 `npm test` 和 `npm run build`；浏览器行为变化时通过本地 Vite 页面核对。
- `node_modules/`、`dist/` 和日志为可再生产物，清理时仅处理本项目内这些目录或文件；用户模型和原项目文件不自动清理。
- 尚未确定公开许可证或代码再授权时，不宣称项目已获开源授权，不公开发布。

## 在线模型案例
### ✅ Khronos 官方样例（标准 glTF/GLB，CORS友好，适合测试材质、动画、变体）

1. 牛油果（简单静态，很小）
`https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Avocado/glTF-Binary/Avocado.glb`
2. 破损头盔（经典 PBR，常用测试）
`https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/DamagedHelmet/glTF-Binary/DamagedHelmet.glb`
3. 狐狸（带动画！适合测试动画播放）
`https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb`
4. 鞋子（材质变体 variants，测试多材质切换）
`https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/MaterialsVariantsShoe/glTF-Binary/MaterialsVariantsShoe.glb`
5. 玩具小车
`https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/ToyCar/glTF-Binary/ToyCar.glb`
6. 灯笼
`https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Lantern/glTF-Binary/Lantern.glb`

### ✅ Three.js 样例（带动画角色）

7. 士兵动画模型
`https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Soldier.glb`

### ✅ Babylon.js CDN（稳定国内访问相对好一点）

8. Boombox 收音机
`https://assets.babylonjs.com/meshes/boombox.glb`
