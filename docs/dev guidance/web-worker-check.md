# 检查公司浏览器能否使用 Web Worker

> 用途：[release-checklist.md](release-checklist.md) 第 1 节中 Web Worker 一项的具体做法。在公司 Windows 电脑上做，大约 10 分钟。

## 为什么要查

docdiff 读取文件在页面上进行，比较两份文档在后台线程（Web Worker）中进行，这样比较长文档时页面不会冻住。

有的公司浏览器策略或网站安全设置会禁止后台线程。这时 docdiff 会**自动、静默地**改在页面上比较：结果完全一样，界面上也没有任何提示，只是长文档比较时页面会冻住几秒。所以要专门查一下，看界面看不出来。

## 要在哪些地方查

浏览器的限制是按页面生效的：同一台电脑上，双击打开的本地文件和 Posit Connect 上的网页，结果可能不一样。每种打开方式都要单独查：

| # | 打开方式 | 浏览器 |
|---|---|---|
| A | 双击本地的 `index.html` | Edge |
| B | 双击本地的 `index.html` | Chrome |
| C | Posit Connect 上发布的 docdiff 链接 | 同事主要用的浏览器 |

## 方法一：在控制台运行一段检查代码（准确）

1. 用上表的方式打开 docdiff，停在首页即可，不用选文件。
2. 按 **F12**（或右键页面 → “检查”），打开开发者工具，切到 **Console（控制台）** 标签。
3. 如果控制台提示不能粘贴代码（Chrome 有时会这样），先输入 `allow pasting` 并回车。
4. 粘贴下面整段代码，按回车：

   ```js
   new Promise(r=>{setTimeout(()=>r('No answer in 3 s: treat as blocked'),3000);try{const w=new Worker(URL.createObjectURL(new Blob(['postMessage(1)'],{type:'text/javascript'})));w.onmessage=()=>{r('Worker allowed');w.terminate()};w.onerror=e=>r('Worker blocked: '+(e.message||'load error'))}catch(e){r('Worker blocked: '+e.message)}})
   ```

5. 看控制台输出的结果：

| 输出 | 含义 |
|---|---|
| `Worker allowed` | 可以使用后台线程，比较在后台进行 |
| `Worker blocked: …` | 被禁止，docdiff 会改在页面上比较。把冒号后面的文字记下来 |
| `No answer in 3 s: treat as blocked` | 按被禁止处理，同样记下来 |

被禁止时，控制台里通常还会有一行红色报错，常见的是含有 `Content Security Policy` 或 `worker-src` 的文字。请截图，开发方要靠它判断原因。

这段代码和 docdiff 创建后台线程的方式相同（都用 `blob:` 地址），所以结果能代表 docdiff 的实际情况。它不读取、不发送任何文件，关掉页面就没有了。

## 方法二：比较长文档时看页面会不会冻住（粗略）

公司电脑禁用了 F12 时用这个方法。

1. 在首页点 Sample pair **“07 · Long document”**。
2. 进度框出现后，马上来回移动鼠标，经过页面上的按钮，看按钮会不会随鼠标变色。
3. 判断：
   - 进度框一直在更新，按钮有反应 → 很可能可以使用后台线程。
   - 进度框停在 “Finding word-level differences” 不动，鼠标移到按钮上也没反应，几秒后才突然进入比较页 → 很可能被禁止了。

这一步在快的电脑上只有一两秒，可能看不出区别，所以只能作参考。看不出来时，在记录里写“方法二无法判断”。

## 记录结果

在 [release-checklist.md](release-checklist.md) 第 1 节对应的一行里写：

```text
A Edge 本地：allowed / blocked（报错文字）/ 无法判断
B Chrome 本地：…
C Posit Connect：…
用的方法：一 / 二
```

## 被禁止时怎么办

- **不影响使用**：比较结果、选择、导出都和正常时一样。
- **只影响长文档**：比较时页面冻住几秒。短文档基本感觉不到。
- 把报错截图发给开发方。如果只有 Posit Connect 上被禁止，可能是服务器的安全设置（`worker-src`）所致，可以问 IT 能否允许 `blob:`；本地文件被禁止通常是浏览器策略，一般不必处理。
- 如果三种方式都被禁止，而真实的长文档冻住得太久，再和开发方商量要不要在界面上加“正在比较，页面会暂时没有反应”之类的提示。
