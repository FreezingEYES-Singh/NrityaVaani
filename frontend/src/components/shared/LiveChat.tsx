'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, X, Send, Bot, Sparkles } from 'lucide-react';
import Link from 'next/link';

interface ChatMessage {
  id: string;
  sender: 'bot' | 'user';
  text: React.ReactNode;
}

const FAQ_OPTIONS = [
  { label: "How to use Live Detection?", response: (
      <div className="space-y-3">
        <p>You can use our real-time AI camera tracking by visiting the Live Detection portal!</p>
        <Link href="/live" className="block w-full bg-primary text-black py-2 rounded-lg text-center font-bold hover:scale-[1.02] transition-transform">Open Camera Portal</Link>
      </div>
    ) 
  },
  { label: "Can I upload a photo?", response: (
      <div className="space-y-3">
        <p>Yes! You can upload custom images from your gallery to get deep mudra analytics.</p>
        <Link href="/upload" className="block w-full bg-foreground/10 border border-foreground/20 py-2 rounded-lg text-center font-bold hover:bg-foreground/20 transition-colors">Go to Upload Feature</Link>
      </div>
    ) 
  },
  { label: "How does the AI work?", response: "Our AI uses the Google MediaPipe Neural Engine to track 21 3D finger landmarks up to 60 FPS without lag!" },
  { label: "Contact Support", response: "You can reach our team at support@nrityavaani.com 📧 We usually reply within 24 hours!" }
];

export default function LiveChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: '1', sender: 'bot', text: "Namaste! Welcome to NrityaVaani. I'm DivyBot 🤖 How can I assist your dance journey today?" }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping, isOpen]);

  const handleFAQClick = (faq: typeof FAQ_OPTIONS[0]) => {
    // Add user message
    // crypto.randomUUID rather than Date.now: two clicks inside the same
    // millisecond produced duplicate React keys, and Date.now in a render
    // path is impure besides.
    const newMessage: ChatMessage = { id: crypto.randomUUID(), sender: 'user', text: faq.label };
    setMessages(prev => [...prev, newMessage]);
    
    // Simulate typing
    setIsTyping(true);
    
    setTimeout(() => {
      setIsTyping(false);
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), sender: 'bot', text: faq.response }]);
    }, 1500);
  };

  return (
    <div className="fixed bottom-4 right-4 md:bottom-6 md:right-6 z-[100]">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="absolute bottom-[70px] right-0 w-[calc(100vw-2rem)] sm:w-[350px] shadow-[0_0_50px_rgba(255,153,51,0.15)] rounded-2xl overflow-hidden glass-card border border-foreground/10 flex flex-col bg-background/80 backdrop-blur-3xl"
          >
            {/* Header */}
            <div className="bg-primary/10 p-4 border-b border-foreground/5 flex items-center justify-between relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-transparent opacity-50" />
              <div className="flex items-center space-x-3 relative z-10">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30 shadow-[0_0_15px_rgba(255,153,51,0.4)]">
                   <Bot className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-bold text-foreground text-sm">DivyBot (AI Support)</h3>
                  <div className="flex items-center space-x-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-xs text-foreground/50">Typically replies instantly</span>
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setIsOpen(false)}
                className="w-8 h-8 rounded-full bg-foreground/5 flex items-center justify-center hover:bg-foreground/10 transition-colors relative z-10"
              >
                <X className="w-4 h-4 text-foreground/70" />
              </button>
            </div>

            {/* Chat Area */}
            <div 
              ref={scrollRef}
              className="h-[250px] p-4 overflow-y-auto flex flex-col space-y-4 custom-scrollbar"
            >
              <div className="text-center mb-2">
                <span className="text-[10px] text-foreground/30 uppercase font-bold tracking-widest bg-foreground/5 px-3 py-1 rounded-full">Today</span>
              </div>
              
              {messages.map((msg) => (
                <motion.div 
                  initial={{ opacity: 0, x: msg.sender === 'user' ? 20 : -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  key={msg.id} 
                  className={`flex items-end space-x-2 max-w-[85%] ${msg.sender === 'user' ? 'self-end flex-row-reverse space-x-reverse' : 'self-start'}`}
                >
                   {msg.sender === 'bot' && (
                     <div className="w-6 h-6 rounded-full bg-foreground/10 flex items-center justify-center shrink-0 mb-1">
                       <Bot className="w-3 h-3 text-foreground/60" />
                     </div>
                   )}
                   <div className={`p-3 rounded-2xl text-sm leading-relaxed ${
                     msg.sender === 'user' 
                      ? 'bg-primary text-black rounded-br-sm shadow-[0_0_15px_rgba(255,153,51,0.3)] font-medium' 
                      : 'bg-foreground/10 text-foreground/80 rounded-bl-sm border border-foreground/5'
                   }`}>
                      {msg.text}
                   </div>
                </motion.div>
              ))}

              {isTyping && (
                <motion.div 
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="flex items-center space-x-2 self-start"
                >
                  <div className="w-6 h-6 rounded-full bg-foreground/10 flex items-center justify-center shrink-0">
                    <Bot className="w-3 h-3 text-foreground/60" />
                  </div>
                  <div className="bg-foreground/5 p-3 rounded-2xl rounded-bl-sm border border-foreground/5 flex items-center space-x-1">
                    <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </motion.div>
              )}
            </div>

            {/* Input / FAQ Area */}
            <div className="p-4 bg-foreground/5 border-t border-foreground/5">
              <p className="text-[10px] text-foreground/40 font-bold uppercase tracking-widest mb-3 px-1">Suggested Questions</p>
              <div className="flex flex-wrap gap-2 mb-2">
                {FAQ_OPTIONS.map((faq, i) => (
                  <button
                    key={i}
                    onClick={() => handleFAQClick(faq)}
                    disabled={isTyping}
                    className="text-xs bg-foreground/5 hover:bg-primary/20 hover:text-primary transition-colors border border-foreground/10 rounded-full py-1.5 px-3 text-foreground/70 text-left disabled:opacity-50"
                  >
                    {faq.label}
                  </button>
                ))}
              </div>
              <div className="mt-4 flex items-center space-x-2">
                <input 
                   disabled
                   placeholder="AI processing FAQs currently..."
                   className="flex-1 bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-2.5 text-base outline-none text-foreground/50 opacity-50 cursor-not-allowed"
                />
                <button disabled className="w-10 h-10 rounded-xl bg-primary/20 text-primary flex items-center justify-center opacity-50 cursor-not-allowed">
                  <Send className="w-4 h-4 ml-1" />
                </button>
              </div>
              <div className="mt-3 flex items-center justify-center space-x-1 opacity-40">
                <Sparkles className="w-3 h-3" />
                <span className="text-[9px] uppercase tracking-widest font-bold">Powered by NrityaVaani AI</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="w-14 h-14 bg-primary text-black rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(255,153,51,0.4)] hover:shadow-[0_0_40px_rgba(255,153,51,0.6)] transition-shadow z-[100]"
      >
        <AnimatePresence mode="wait">
          {isOpen ? (
            <motion.div key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }}>
              <X className="w-6 h-6" />
            </motion.div>
          ) : (
            <motion.div key="open" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }}>
              <MessageSquare className="w-6 h-6 fill-black/20" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
}
