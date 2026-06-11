import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import styles from './AgentCard.module.css';
export function AgentCard({ message, accentColor, onResolve }) {
    const isAI = message.direction === 'agent_to_human';
    const time = formatAgentTime(message.createdAt);
    return (_jsxs("div", { className: `${styles.card} ${isAI ? styles.ai : styles.you}`, style: isAI ? { borderLeftColor: accentColor } : undefined, children: [_jsx("div", { className: styles.who, style: isAI ? { color: accentColor } : undefined, children: isAI ? message.agentId : 'You' }), _jsx("div", { className: styles.content, children: message.content }), message.type === 'decision' && !message.resolved && message.options && (_jsx("div", { className: styles.options, children: message.options.map(opt => (_jsx("button", { className: styles.optBtn, style: { borderColor: accentColor, color: accentColor }, onClick: () => onResolve?.(message.id, opt), children: opt }, opt))) })), message.type === 'decision' && message.resolved && (_jsxs("div", { className: styles.resolved, children: ["\u2713 ", message.resolution] })), _jsx("div", { className: styles.time, children: time })] }));
}
function formatAgentTime(ts) {
    return new Date(ts).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}
