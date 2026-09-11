// =============================================================================
// src/ui — WILSON's component kit (plan §4). One file plus one test per
// component; import from the file or from here. index.test.js enumerates
// every export so a component cannot be added without a caller being
// looked for (plan §7, the grep audit: no exported kit component without a
// caller).
//
// Foundation 1 (this file's first commit): tokens and the primitives
// promoted from Bins' binUi.jsx plus Button, IconButton, Switch, Chip,
// Badge, StatusBadge, StatusDot, Field, Dialog, Menu, Toast, Banner,
// EmptyState, Loading, Spinner, Kbd. Foundation 2 adds the shell and data
// primitives (PageHeader, SectionTitle, Card, Table, Toolbar, Tabs, Panel,
// Drawer, Stat, HoverActions). There is no ShortcutBar (Q10, ruled).
// =============================================================================

export * from './tokens'
export * from './contrast'
export * from './overlay'
export { Button, BUTTON_VARIANTS, BUTTON_SIZES } from './Button'
export { IconButton } from './IconButton'
export { Switch } from './Switch'
export { Chip } from './Chip'
export { Badge } from './Badge'
export { StatusDot, STATUS, STATUS_TONES, statusMeta, humanizeStatus } from './StatusDot'
export { StatusBadge } from './StatusBadge'
export { Field } from './Field'
export { Input, useEscapeRevert } from './Input'
export { TextArea } from './TextArea'
export { Select } from './Select'
export { Dialog, DIALOG_WIDTHS } from './Dialog'
export { Menu } from './Menu'
export { Toast, ToastProvider, useToast, TOAST_TONES } from './Toast'
export { Banner, BANNER_TONES } from './Banner'
export { EmptyState } from './EmptyState'
export { Loading } from './Loading'
export { Spinner } from './Spinner'
export { Kbd } from './Kbd'
