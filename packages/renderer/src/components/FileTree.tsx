import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { fa } from '../api/fa.js'
import { useEditorStore } from '../editor-store-instance.js'
import { openFileFromDisk } from '../editor-events.js'

export interface TreeNode {
  path: string // workspace 相对路径，'/' 连接；根为 ''
  name: string
  isDir: boolean
  expanded?: boolean
  loaded?: boolean
  children?: TreeNode[]
}

interface ContextMenu { x: number; y: number; node: TreeNode }
interface PendingInput {
  mode: 'create-file' | 'create-dir' | 'rename'
  parentDir: string // 行内输入行挂在哪个目录的 children 里（'' = 根）
  nodePath?: string // 重命名的目标节点
  initial: string
}

const parentOf = (path: string): string => {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

const toChildren = (parent: string, entries: { name: string; isDir: boolean }[]): TreeNode[] =>
  entries.map((e) => ({ path: parent ? `${parent}/${e.name}` : e.name, name: e.name, isDir: e.isDir }))

function updateDir(nodes: TreeNode[], dirPath: string, patch: (n: TreeNode) => TreeNode): TreeNode[] {
  return nodes.map((n) =>
    n.path === dirPath ? patch(n)
      : n.children ? { ...n, children: updateDir(n.children, dirPath, patch) }
        : n)
}

function findNode(nodes: TreeNode[], path: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.path === path) return n
    if (n.children) { const r = findNode(n.children, path); if (r) return r }
  }
  return undefined
}

// 契约 9：所有 fa.fs 调用的 rejection 统一 setNotice 兜底
const fsErr = (e: unknown): void => { useEditorStore.getState().setNotice(String(e)) }

const rowStyle = (depth: number): React.CSSProperties => ({
  paddingLeft: 4 + depth * 16,
  paddingRight: 4,
  lineHeight: '24px',
  fontSize: 13,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  userSelect: 'none',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
})

const iconBtn: React.CSSProperties = { border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, padding: '2px 4px', lineHeight: '16px', color: '#555' }

export function FileTree({ onOpenFile = openFileFromDisk }: { onOpenFile?: (path: string) => void }): React.JSX.Element {
  const [rootChildren, setRootChildren] = useState<TreeNode[] | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [menu, setMenu] = useState<ContextMenu | null>(null)
  const [pending, setPending] = useState<PendingInput | null>(null)
  const [pendingValue, setPendingValue] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const agentTouched = useEditorStore((s) => s.agentTouched)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 行内输入行挂载时聚焦并全选（重命名预填旧名）。依赖 pending 而非每次渲染，
  // 避免内联 ref 回调每帧 select() 导致输入被整体替换。
  useEffect(() => {
    if (pending) { inputRef.current?.focus(); inputRef.current?.select() }
  }, [pending])

  // 契约 1：挂载（依赖 refreshKey）载入根；手动刷新整体重建（丢弃展开态）
  useEffect(() => {
    setRootChildren(null)
    setPending(null)
    fa.fs.list('.')
      .then((entries) => setRootChildren(toChildren('', entries)))
      .catch((e) => { fsErr(e); setRootChildren([]) })
  }, [refreshKey])

  // 契约 4：点击菜单外关闭（mousedown 先于 click/contextmenu，天然支持“关旧开新”）
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent): void => {
      const el = menuRef.current
      if (el && e.target instanceof Node && !el.contains(e.target)) setMenu(null)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menu])

  // 契约 2：懒加载——未 loaded 才拉取；已 loaded 仅切换 expanded（再次展开不重新拉取）
  const onDirClick = (node: TreeNode): void => {
    if (!node.loaded) {
      fa.fs.list(node.path)
        .then((entries) => setRootChildren((cur) => cur ? updateDir(cur, node.path, (n) => ({ ...n, loaded: true, expanded: true, children: toChildren(node.path, entries) })) : cur))
        .catch(fsErr)
    } else {
      setRootChildren((cur) => cur ? updateDir(cur, node.path, (n) => ({ ...n, expanded: !n.expanded })) : cur)
    }
  }

  // 受影响目录刷新：重拉该目录 children（保持展开）
  const refreshDir = (dirPath: string): void => {
    if (dirPath === '') {
      fa.fs.list('.').then((entries) => setRootChildren(toChildren('', entries))).catch(fsErr)
      return
    }
    fa.fs.list(dirPath)
      .then((entries) => setRootChildren((cur) => cur ? updateDir(cur, dirPath, (n) => ({ ...n, loaded: true, expanded: true, children: toChildren(dirPath, entries) })) : cur))
      .catch(fsErr)
  }

  // 新建目标目录尚未加载/展开时先展开，让行内输入行有落点
  const ensureDirOpen = (dirPath: string): void => {
    if (dirPath === '') return
    const node = rootChildren ? findNode(rootChildren, dirPath) : undefined
    if (node && !node.loaded) {
      fa.fs.list(dirPath)
        .then((entries) => setRootChildren((cur) => cur ? updateDir(cur, dirPath, (n) => ({ ...n, loaded: true, expanded: true, children: toChildren(dirPath, entries) })) : cur))
        .catch(fsErr)
    } else {
      setRootChildren((cur) => cur ? updateDir(cur, dirPath, (n) => ({ ...n, expanded: true })) : cur)
    }
  }

  // 契约 5/6：行内输入确认 → create / rename → 刷新父目录
  const confirmPending = (): void => {
    if (!pending) return
    const name = pendingValue.trim()
    if (!name) { setPending(null); return }
    const to = pending.parentDir ? `${pending.parentDir}/${name}` : name
    const done = (): void => setPending(null)
    if (pending.mode === 'rename' && pending.nodePath) {
      fa.fs.rename(pending.nodePath, to).then(() => refreshDir(pending.parentDir)).catch(fsErr).finally(done)
    } else {
      const kind = pending.mode === 'create-dir' ? 'dir' : 'file'
      fa.fs.create(to, kind).then(() => refreshDir(pending.parentDir)).catch(fsErr).finally(done)
    }
  }

  const startCreate = (kind: 'file' | 'dir'): void => {
    if (!menu) return
    const parentDir = menu.node.isDir ? menu.node.path : parentOf(menu.node.path)
    ensureDirOpen(parentDir)
    setPending({ mode: kind === 'file' ? 'create-file' : 'create-dir', parentDir, initial: '' })
    setPendingValue('')
  }

  const startRename = (): void => {
    if (!menu) return
    setPending({ mode: 'rename', parentDir: parentOf(menu.node.path), nodePath: menu.node.path, initial: menu.node.name })
    setPendingValue(menu.node.name)
  }

  // 契约 7：删除必须经 window.confirm
  const doDelete = (): void => {
    if (!menu) return
    const node = menu.node
    if (window.confirm(`确定删除 ${node.name}？`)) {
      fa.fs.delete(node.path).then(() => refreshDir(parentOf(node.path))).catch(fsErr)
    }
  }

  const renderInput = (depth: number): React.JSX.Element => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, paddingLeft: 4 + depth * 16, lineHeight: '24px', fontSize: 13 }}>
      <input
        ref={inputRef}
        value={pendingValue}
        onChange={(e) => setPendingValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') confirmPending()
          if (e.key === 'Escape') setPending(null)
        }}
        style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: '18px', padding: '1px 4px', boxSizing: 'border-box' }}
      />
      <button type="button" title="确认" style={iconBtn} onClick={confirmPending}>✓</button>
      <button type="button" title="取消" style={iconBtn} onClick={() => setPending(null)}>×</button>
    </div>
  )

  const renderList = (nodes: TreeNode[], depth: number, listPath: string): React.JSX.Element[] => {
    const rows: React.JSX.Element[] = []
    if (pending && (pending.mode === 'create-file' || pending.mode === 'create-dir') && pending.parentDir === listPath) {
      rows.push(<div key="__pending_create__">{renderInput(depth)}</div>)
    }
    for (const node of nodes) {
      if (pending?.mode === 'rename' && pending.nodePath === node.path) {
        rows.push(<div key={node.path}>{renderInput(depth)}</div>)
        continue
      }
      rows.push(
        <div key={node.path}>
          <div
            className="fa-tree-row"
            style={rowStyle(depth)}
            onClick={() => (node.isDir ? onDirClick(node) : onOpenFile(node.path))}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ x: Math.min(e.clientX, window.innerWidth - 150), y: Math.min(e.clientY, window.innerHeight - 130), node })
            }}
          >
            {node.isDir && <span style={{ marginRight: 4 }}>{node.expanded ? '📂' : '📁'}</span>}
            {node.name}
            {/* 契约 8：agentTouched 路径节点名旁小圆点 */}
            {agentTouched.includes(node.path) && <span style={{ color: '#1a73e8', marginLeft: 4 }}>●</span>}
          </div>
          {node.isDir && node.expanded && node.children && renderList(node.children, depth + 1, node.path)}
        </div>,
      )
    }
    return rows
  }

  if (collapsed) {
    return (
      <div style={{ width: 32, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 4 }}>
        <button type="button" title="展开文件树" style={iconBtn} onClick={() => setCollapsed(false)}>»</button>
      </div>
    )
  }

  const menuItem = (label: string, action: () => void): React.JSX.Element => (
    <div
      key={label}
      className="fa-tree-row"
      style={{ padding: '2px 12px', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}
      onClick={() => { setMenu(null); action() }}
    >
      {label}
    </div>
  )

  return (
    <div style={{ width: '100%', minHeight: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
      {/* hover 背景 #f0f0f0（行与菜单项共用） */}
      <style>{'.fa-tree-row:hover{background:#f0f0f0}'}</style>
      {/* 契约 10：标题 + ⟳ 刷新；« 折叠为 32px 窄条 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px 2px 10px', borderBottom: '1px solid #eee', fontSize: 12, color: '#555', flexShrink: 0 }}>
        <span>工作区</span>
        <span style={{ display: 'flex' }}>
          <button type="button" title="刷新" style={iconBtn} onClick={() => setRefreshKey((k) => k + 1)}>⟳</button>
          <button type="button" title="折叠" style={iconBtn} onClick={() => setCollapsed(true)}>«</button>
        </span>
      </div>
      <div style={{ paddingTop: 2 }}>
        {rootChildren === null
          ? <div style={{ color: '#999', fontSize: 12, padding: '4px 10px' }}>加载中…</div>
          : renderList(rootChildren, 0, '')}
      </div>
      {/* 契约 4：fixed 定位于鼠标处的自定义菜单 */}
      {menu && (
        <div
          ref={menuRef}
          style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 1000, background: '#fff', border: '1px solid #ccc', borderRadius: 4, boxShadow: '0 2px 8px rgba(0,0,0,.15)', padding: '4px 0', minWidth: 120 }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menuItem('新建文件', () => startCreate('file'))}
          {menuItem('新建文件夹', () => startCreate('dir'))}
          {menuItem('重命名', startRename)}
          {menuItem('删除', doDelete)}
        </div>
      )}
    </div>
  )
}
