/* 更新点：
   - 在 fetchGitHubRepoStructure() 中记录 this.basePath（例如 "VoidMuseum/main"）
   - buildRawGitHubUrl() 会把 this.basePath 加到 filePath 前面（如果尚未包含），并逐段 encodeURIComponent
*/
class CyberTerminal {
    constructor() {
        this.outputElement = document.getElementById('output');
        this.inputElement = document.getElementById('command-input');
        this.pathElement = document.getElementById('current-path');
        this.commandHistory = [];
        this.historyIndex = -1;
        
        // GitHub配置
        this.githubConfig = {
            repo: 'Trievy/Trievy.github.io',
            branch: 'main',
            token: ''
        };
        
        // basePath 会在 fetch 时设置，例如 "VoidMuseum/main"
        this.basePath = '';

        // 初始文件系统（空）
        this.fileSystem = {
            name: '~',
            type: 'directory',
            children: {}
        };

        // code 到文件的映射表
        this.codeMap = {
            'UNFINISHEDSTORY':"docs/谢幕.txt",
            'COLLAPSEDEXISTENCE':"docs/入殓师_01.txt",
            'TOWARDSBEGINNING':"docs/入殓师与旅者的谈话.txt"
        };
        // 当前目录路径
        this.currentPath = [this.fileSystem];
        
        // 扩展命令列表
        this.commands = {
            'help': this.showHelp.bind(this),
            'clear': this.clearTerminal.bind(this),
            'echo': this.echoText.bind(this),
            'ls': this.listFiles.bind(this),
            'list': this.listFiles.bind(this),
            'cd': this.changeDirectory.bind(this),
            'scp': this.downloadSpecificFile.bind(this),
            'pwd': this.showCurrentDirectory.bind(this),
            'recover': this.recoverByCode.bind(this)
        };
        
        this.init();
        this.loadGitHubRepo();
    }
    
    init() {
        this.inputElement.addEventListener('keydown', this.handleInput.bind(this));
        this.inputElement.focus();
        this.updatePrompt();
        
        // 添加全局点击聚焦输入框
        document.addEventListener('click', () => {
            this.inputElement.focus();
        });
    }
    
    async loadGitHubRepo() {

        try {
            const fileSystem = await this.fetchGitHubRepoStructure();
            this.fileSystem = fileSystem;
            
            // 重置当前路径到根目录
            this.currentPath = [this.fileSystem];
            this.updatePrompt();
        } catch (error) {
            this.addToOutput(`错误: ${error.message}`, 'error');
            if (error.message.includes('401') || error.message.includes('403')) {
                this.addToOutput('请检查GitHub Token是否正确且有访问权限', 'error');
            }
        }
    }
    
    async fetchGitHubRepoStructure() {
        const { repo, branch, token } = this.githubConfig;
        
        // 首先获取根目录的内容，找到 VoidMuseum 文件夹
        const rootUrl = `https://api.github.com/repos/${repo}/git/trees/${branch}`;
        
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'CyberTerminal'
        };
        
        if (token) {
            headers['Authorization'] = `token ${token}`;
        }
        
        // 获取根目录
        const rootResponse = await fetch(rootUrl, { headers });
        
        if (!rootResponse.ok) {
            throw new Error(`GitHub API 错误: ${rootResponse.status} ${rootResponse.statusText}`);
        }
        
        const rootData = await rootResponse.json();
        
        // 查找 VoidMuseum 文件夹
        const vMainFolder = rootData.tree.find(item => 
            item.type === 'tree' && item.path.toLowerCase() === 'voidmuseum'
        );
        
        if (!vMainFolder) {
            throw new Error('在仓库中未找到 VoidMuseum 文件夹');
        }
        
        // 获取 VoidMuseum 的递归内容
        const vMainUrl = `https://api.github.com/repos/${repo}/git/trees/${vMainFolder.sha}?recursive=1`;
        const vMainResponse = await fetch(vMainUrl, { headers });
        
        if (!vMainResponse.ok) {
            throw new Error(`GitHub API 错误: ${vMainResponse.status} ${vMainResponse.statusText}`);
        }

        const vMainData = await vMainResponse.json();

        // 查找 main 文件夹（位于 VoidMuseum 下）
        const mainFolder = vMainData.tree.find(item => 
            item.type === 'tree' && item.path.toLowerCase() === 'main'
        );
        
        if (!mainFolder) {
            throw new Error('在仓库中未找到 main 文件夹');
        }

        // 记录 basePath（相对于仓库根的完整路径），用于构建 raw 下载 URL
        this.basePath = `${vMainFolder.path}/${mainFolder.path}`; // e.g. "VoidMuseum/main"
        
        // 获取 main 文件夹的递归内容
        const mainUrl = `https://api.github.com/repos/${repo}/git/trees/${mainFolder.sha}?recursive=1`;
        const mainResponse = await fetch(mainUrl, { headers });
        
        if (!mainResponse.ok) {
            throw new Error(`GitHub API 错误: ${mainResponse.status} ${mainResponse.statusText}`);
        }
        
        const mainData = await mainResponse.json();
        
        // 将GitHub API响应转换为我们的文件系统结构
        return this.convertGitHubTreeToFileSystem(mainData.tree);
    }
    
    convertGitHubTreeToFileSystem(tree) {
        const root = {
            name: '~',
            type: 'directory',
            children: {}
        };
        
        // 首先创建所有目录
        tree.forEach(item => {
            if (item.type === 'tree') {
                // 目录
                const pathParts = item.path.split('/');
                this.createDirectoryStructure(root, pathParts, item);
            }
        });
        
        // 然后添加文件
        tree.forEach(item => {
            if (item.type === 'blob') {
                // 文件
                const pathParts = item.path.split('/');
                this.addFileToStructure(root, pathParts, item);
            }
        });

        return root;
    }
    
    createDirectoryStructure(root, pathParts, item) {
        let current = root;
        
        for (let i = 0; i < pathParts.length; i++) {
            const part = pathParts[i];
            
            if (!current.children[part]) {
                current.children[part] = {
                    name: part,
                    type: 'directory',
                    children: {}
                };
            }
            
            current = current.children[part];
        }
    }
    
    addFileToStructure(root, pathParts, item) {
        let current = root;
        
        // 遍历到文件的父目录
        for (let i = 0; i < pathParts.length - 1; i++) {
            const part = pathParts[i];
            current = current.children[part];
        }
        
        // 添加文件
        const fileName = pathParts[pathParts.length - 1];
        current.children[fileName] = {
            name: fileName,
            type: 'file',
            size: this.formatFileSize(item.size || 0),
            sha: item.sha,
            path: item.path
        };
    }
    
    formatFileSize(bytes) {
        if (bytes === 0) return '0B';
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
    }
    
    handleInput(event) {
        switch(event.key) {
            case 'Enter':
                this.executeCommand();
                break;
            case 'ArrowUp':
                event.preventDefault();
                this.navigateHistory(-1);
                break;
            case 'ArrowDown':
                event.preventDefault();
                this.navigateHistory(1);
                break;
            case 'Tab':
                event.preventDefault();
                this.autoComplete();
                break;
        }
    }
    
    executeCommand() {
        const command = this.inputElement.value.trim();
        if (!command) return;
        
        this.addToOutput(`${this.getPrompt()} ${command}`, 'input');
        this.commandHistory.push(command);
        this.historyIndex = this.commandHistory.length;
        
        // 改进的命令解析，支持带引号的参数
        const [cmd, ...args] = this.parseCommand(command);
        const handler = this.commands[cmd.toLowerCase()];
        
        if (handler) {
            handler(args);
        } else {
            this.addToOutput(`命令未找到: ${cmd}。输入 'help' 查看可用命令。`, 'error');
        }
        
        this.inputElement.value = '';
        this.scrollToBottom();
    }

    // 新增方法：解析命令行参数，支持带引号的字符串
    parseCommand(command) {
        const args = [];
        let currentArg = '';
        let inQuotes = false;
        let quoteChar = '';
        
        for (let i = 0; i < command.length; i++) {
            const char = command[i];
            
            if ((char === '"' || char === "'") && !inQuotes) {
                // 开始引号
                inQuotes = true;
                quoteChar = char;
            } else if (char === quoteChar && inQuotes) {
                // 结束引号
                inQuotes = false;
                quoteChar = '';
            } else if (char === ' ' && !inQuotes) {
                // 空格分隔符（不在引号内）
                if (currentArg) {
                    args.push(currentArg);
                    currentArg = '';
                }
            } else {
                // 普通字符
                currentArg += char;
            }
        }
        
        // 添加最后一个参数
        if (currentArg) {
            args.push(currentArg);
        }
        
        return args;
    }
    
    navigateHistory(direction) {
        if (this.commandHistory.length === 0) return;
        
        this.historyIndex = Math.max(0, Math.min(this.commandHistory.length, this.historyIndex + direction));
        
        if (this.historyIndex === this.commandHistory.length) {
            this.inputElement.value = '';
        } else {
            this.inputElement.value = this.commandHistory[this.historyIndex];
        }
    }
    
    autoComplete() {
        const input = this.inputElement.value.toLowerCase();
        const matches = Object.keys(this.commands).filter(cmd => 
            cmd.startsWith(input)
        );
        
        if (matches.length === 1) {
            this.inputElement.value = matches[0];
        } else if (matches.length > 1) {
            this.addToOutput(`可能的命令: ${matches.join(', ')}`, 'info');
        }
    }
    
    addToOutput(text, type = 'normal') {
        const line = document.createElement('div');
        line.className = 'output-line';
        
        switch(type) {
            case 'input':
                line.innerHTML = `<span class="prompt">${this.getPrompt()}</span> ${text.replace(`${this.getPrompt()} `, '')}`;
                break;
            case 'error':
                line.innerHTML = `<span style="color: #ff4444;">错误:</span> ${text}`;
                break;
            case 'success':
                line.innerHTML = `<span style="color: #44ff44;">成功:</span> ${text}`;
                break;
            case 'info':
                line.innerHTML = `<span style="color: #4488ff;">信息:</span> ${text}`;
                break;
            default:
                line.innerHTML = text;
        }
        
        this.outputElement.appendChild(line);
    }
    
    scrollToBottom() {
        this.outputElement.scrollTop = this.outputElement.scrollHeight;
    }
    
    getPrompt() {
        const path = this.currentPath.map(node => node.name).join('/');
        return `user@terminal:${path}$`;
    }
    
    updatePrompt() {
        this.pathElement.textContent = this.getPrompt();
    }
    
    getCurrentDirectory() {
        return this.currentPath[this.currentPath.length - 1];
    }
    
    // Helper: 构建 raw.githubusercontent.com 下载 URL（对路径段单独 encode，并且在必要时加上 this.basePath）
    buildRawGitHubUrl(filePath) {
        const { repo, branch } = this.githubConfig;
        const [owner, repository] = repo.split('/');
        let fullPath = String(filePath || '').replace(/^\/+/, '').replace(/\/+$/, '');
        // 如果有 basePath 且 filePath 不是已经完整路径，则加上 basePath
        if (this.basePath) {
            // 如果 fullPath 已以 basePath 开头（忽略大小写），就不用再加
            const normalizedFull = fullPath.toLowerCase();
            const normalizedBase = this.basePath.toLowerCase().replace(/^\/+|\/+$/g, '');
            if (!normalizedFull.startsWith(normalizedBase)) {
                fullPath = `${this.basePath}/${fullPath}`.replace(/\/+/g, '/');
            }
        }
        // 对每个段进行 encodeURIComponent（保留 /）
        const encodedPath = fullPath.split('/').map(encodeURIComponent).join('/');
        return `https://raw.githubusercontent.com/${owner}/${repository}/${branch}/${encodedPath}`;
    }

    // 命令实现
    showHelp() {
        const helpText = [
            '可用命令:',
            '  clear          - 清空终端',
            '  echo [文本]    - 回显文本',
            '  ls, list       - 列出当前目录内容',
            '  cd [目录]      - 切换目录',
            '  scp [文件名]   - 下载指定文件',
            '  pwd            - 显示当前目录路径',
            '  recover [code] - 根据recovery code恢复对应文件'
        ];
        
        helpText.forEach(line => this.addToOutput(line));
    }
    
    clearTerminal() {
        this.outputElement.innerHTML = '';
        this.addToOutput('终端已清空', 'info');
    }
    
    echoText(args) {
        if (args.length > 0) {
            this.addToOutput(args.join(' '));
        } else {
            this.addToOutput('用法: echo [文本]', 'error');
        }
    }
    
    listFiles() {
        const currentDir = this.getCurrentDirectory();
        
        if (currentDir.type !== 'directory') {
            this.addToOutput('错误: 当前路径不是目录', 'error');
            return;
        }
        
        const children = Object.values(currentDir.children);
        
        if (children.length === 0) {
            this.addToOutput('目录为空');
            return;
        }
        
        // 创建文件列表容器
        const fileList = document.createElement('div');
        fileList.className = 'file-list';
        
        children.forEach(item => {
            const fileItem = document.createElement('div');
            fileItem.className = `file-item ${item.type}`;
            
            if (item.type === 'directory') {
                fileItem.innerHTML = `<span class="directory">${item.name}/</span>`;
                
                // 为目录添加点击事件（切换到目录）
                fileItem.addEventListener('click', () => {
                    this.inputElement.value = `cd "${item.name}"`;
                    this.inputElement.focus();
                });
                fileItem.style.cursor = 'pointer';
            } else {
                const displayName = item.name;
                fileItem.innerHTML = `<span class="file">${displayName}</span>`;
                if (item.size) {
                    fileItem.innerHTML += ` <span style="color: #888;">(${item.size})</span>`;
                }
                
                // 为文件添加点击事件（填充下载命令）
                fileItem.addEventListener('click', () => {
                    // 如果文件名包含空格，使用引号
                    const command = item.name.includes(' ') ? 
                        `scp "${item.name}"` : `scp ${item.name}`;
                    this.inputElement.value = command;
                    this.inputElement.focus();
                });
            }
            
            fileList.appendChild(fileItem);
        });
        this.addToOutput('Tip:点击列出的项目可以自动填充对应指令','info');
        
        this.outputElement.appendChild(fileList);
    }
    
    changeDirectory(args) {
        if (args.length === 0) {
            // 如果没有参数，回到根目录
            this.currentPath = [this.fileSystem];
            this.updatePrompt();
            this.addToOutput('已切换到主目录');
            return;
        }
        
        const targetDir = args[0];
        const currentDir = this.getCurrentDirectory();
        
        if (currentDir.type !== 'directory') {
            this.addToOutput('错误: 当前路径不是目录', 'error');
            return;
        }
        
        if (targetDir === '..') {
            // 返回上一级目录
            if (this.currentPath.length > 1) {
                this.currentPath.pop();
                this.updatePrompt();
                this.addToOutput(`已切换到目录: ${this.getPrompt()}`);
            } else {
                this.addToOutput('错误: 已经在根目录', 'error');
            }
            return;
        }
        
        // 查找目标目录
        if (currentDir.children[targetDir] && currentDir.children[targetDir].type === 'directory') {
            this.currentPath.push(currentDir.children[targetDir]);
            this.updatePrompt();
            this.addToOutput(`已切换到目录: ${this.getPrompt()}`);
        } else {
            this.addToOutput(`错误: 目录 '${targetDir}' 不存在`, 'error');
        }
    }
    
    async downloadSpecificFile(args) {
        if (args.length === 0) {
            this.addToOutput('用法: scp [文件名]', 'error');
            this.addToOutput('示例: scp README.md', 'info');
            return;
        }

        const filename = args[0];
        const currentDir = this.getCurrentDirectory();

        if (currentDir.type !== 'directory') {
            this.addToOutput('错误: 当前路径不是目录', 'error');
            return;
        }

        // 查找文件
        if (currentDir.children[filename] && currentDir.children[filename].type === 'file') {
            const fileInfo = currentDir.children[filename];
            
            try {
                this.addToOutput(`正在下载: ${filename}`, 'info');
                
                // 构建文件下载URL，使用 raw.githubusercontent.com，并对路径段进行编码
                let filePath = fileInfo.path || filename;
                
                // 如果当前不在根目录且 fileInfo.path 不可用，需要拼接当前路径段
                if (this.currentPath.length > 1 && !fileInfo.path) {
                    const pathParts = this.currentPath.slice(1).map(node => node.name);
                    filePath = pathParts.join('/') + '/' + filename;
                }

                const downloadUrl = this.buildRawGitHubUrl(filePath);

                // 创建下载链接
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = filename;
                a.rel = 'noopener';
                a.target = '_blank';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                this.addToOutput(`文件下载已开始: ${filename}`, 'success');
            } catch (error) {
                this.addToOutput(`下载失败: ${error.message}`, 'error');
            }
        } else {
            this.addToOutput(`错误: 文件 '${filename}' 不存在`, 'error');
        }
    }
    
    showCurrentDirectory() {
        const path = this.currentPath.map(node => node.name).join('/');
        this.addToOutput(path);
    }// 新增方法：根据code恢复/下载对应文件

    recoverByCode(args) {
        if (args.length === 0) {
            this.addToOutput('用法: recover [code]', 'error');
            return;
        }

        const code = args[0];
        
        // 查找对应的文件路径
        const filePath = this.codeMap[code];
        
        if (!filePath) {
            this.addToOutput(`错误: 未知的code '${code}'`, 'error');
            return;
        }
        
        if (!this.githubConfig.repo) {
            this.addToOutput('错误: 未配置GitHub仓库，无法下载文件', 'error');
            this.addToOutput('请先配置GitHub仓库', 'info');
            return;
        }
        
        try {
            this.addToOutput(`正在恢复文件，code: ${code}`, 'info');
            
            // 构建 raw.githubusercontent 下载 URL（并对路径段编码，避免 '#'、空格问题）
            const downloadUrl = this.buildRawGitHubUrl(filePath);
            
            // 提取文件名
            const fileName = filePath.split('/').pop();
            
            // 创建下载链接
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = fileName;
            a.rel = 'noopener';
            a.target = '_blank';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            this.addToOutput(`恢复文件已开始: ${fileName}`, 'success');
            
        } catch (error) {
            this.addToOutput(`恢复失败: ${error.message}`, 'error');
        }
    }
}

// 初始化终端
document.addEventListener('DOMContentLoaded', () => {
    new CyberTerminal();
});

// 保持输入框焦点
document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey) {
        if (event.key === 'k') {
            event.preventDefault();
            document.getElementById('output').innerHTML = '';
        } else if (event.key === 'l') {
            event.preventDefault();
            document.getElementById('command-input').focus();
        }
    }
});
