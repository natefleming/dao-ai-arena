interface Message {
  role: string;
  content: string;
  latency?: number;
  ttft?: number;
}

interface MessageBubbleProps {
  message: Message;
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg p-3 ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-gray-700 text-gray-200'
        }`}
      >
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        {(message.latency || message.ttft) && (
          <div className="text-xs mt-2 opacity-70 space-y-0.5">
            {message.ttft && (
              <p className="flex items-center gap-1">
                <span className="font-semibold">TTFT:</span> {message.ttft}ms
              </p>
            )}
            {message.latency && (
              <p className="flex items-center gap-1">
                <span className="font-semibold">Total:</span> {message.latency}ms
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
