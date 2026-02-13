'use client';

import { useState } from 'react';
import { Upload, Music, CreditCard, Send } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface MemoryBookData {
  lovedOneName: string;
  photos: File[];
  videos: File[];
  selectedMusic: string;
}

export default function MemoryBookChatbot() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "Hi! I'm here to help you create a beautiful memory book for your loved one. Let's start - what is the name of the person you'd like to create this memory book for?",
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState<'name' | 'photos' | 'videos' | 'music' | 'payment' | 'complete'>('name');
  const [memoryBookData, setMemoryBookData] = useState<MemoryBookData>({
    lovedOneName: '',
    photos: [],
    videos: [],
    selectedMusic: '',
  });

  const musicOptions = [
    'Peaceful Piano',
    'Classic Memories',
    'Gentle Guitar',
    'Orchestral Dreams',
    'Nature Sounds',
    'Custom Upload',
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Process based on current step
      let assistantResponse = '';
      
      if (currentStep === 'name') {
        setMemoryBookData((prev) => ({ ...prev, lovedOneName: input }));
        assistantResponse = `Thank you! We'll create a beautiful memory book for ${input}. Now, would you like to upload some photos? You can upload multiple images that capture special moments.`;
        setCurrentStep('photos');
      } else if (currentStep === 'photos') {
        assistantResponse = "Great! Now, would you like to add any videos? Videos can bring memories to life in a special way.";
        setCurrentStep('videos');
      } else if (currentStep === 'videos') {
        assistantResponse = "Wonderful! Let's add some music to your memory book. Please choose from the options below or upload your own music.";
        setCurrentStep('music');
      } else if (currentStep === 'music') {
        setMemoryBookData((prev) => ({ ...prev, selectedMusic: input }));
        assistantResponse = `Perfect! You've chosen "${input}". Your memory book is almost ready. The total cost is $29.99. Would you like to proceed to payment?`;
        setCurrentStep('payment');
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: assistantResponse }]);
    } catch (error) {
      console.error('Error:', error);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, there was an error. Please try again.' },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'photos' | 'videos') => {
    const files = Array.from(e.target.files || []);
    
    if (type === 'photos') {
      setMemoryBookData((prev) => ({ ...prev, photos: [...prev.photos, ...files] }));
      const fileNames = files.map((f) => f.name).join(', ');
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: `Uploaded ${files.length} photo(s): ${fileNames}` },
      ]);
    } else {
      setMemoryBookData((prev) => ({ ...prev, videos: [...prev.videos, ...files] }));
      const fileNames = files.map((f) => f.name).join(', ');
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: `Uploaded ${files.length} video(s): ${fileNames}` },
      ]);
    }
  };

  const handleMusicSelection = (music: string) => {
    setMemoryBookData((prev) => ({ ...prev, selectedMusic: music }));
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: `Selected music: ${music}` },
      {
        role: 'assistant',
        content: `Great choice! You've selected "${music}". Your memory book is almost ready. The total cost is $29.99. Would you like to proceed to payment?`,
      },
    ]);
    setCurrentStep('payment');
  };

  const handlePayment = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/memorybook/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lovedOneName: memoryBookData.lovedOneName,
          photoCount: memoryBookData.photos.length,
          videoCount: memoryBookData.videos.length,
          music: memoryBookData.selectedMusic,
        }),
      });

      const { url } = await response.json();
      
      if (url) {
        window.location.href = url;
      }
    } catch (error) {
      console.error('Payment error:', error);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, there was an error processing payment. Please try again.' },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-purple-50 flex flex-col">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200 p-4">
        <h1 className="text-2xl font-semibold text-gray-800 text-center">Memory Book Creator</h1>
        <p className="text-sm text-gray-600 text-center mt-1">Create a beautiful tribute for your loved one</p>
      </header>

      {/* Chat Container */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-4xl mx-auto w-full">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg p-3 ${
                message.role === 'user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-white text-gray-800 shadow-sm border border-gray-200'
              }`}
            >
              <p className="text-sm">{message.content}</p>
            </div>
          </div>
        ))}

        {/* File Upload Section */}
        {currentStep === 'photos' && (
          <div className="flex justify-center">
            <label className="flex flex-col items-center px-6 py-4 bg-white text-blue-500 rounded-lg shadow-md border border-blue-300 cursor-pointer hover:bg-blue-50 transition">
              <Upload className="w-8 h-8 mb-2" />
              <span className="text-sm">Upload Photos</span>
              <input
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFileUpload(e, 'photos')}
              />
            </label>
          </div>
        )}

        {currentStep === 'videos' && (
          <div className="flex justify-center">
            <label className="flex flex-col items-center px-6 py-4 bg-white text-blue-500 rounded-lg shadow-md border border-blue-300 cursor-pointer hover:bg-blue-50 transition">
              <Upload className="w-8 h-8 mb-2" />
              <span className="text-sm">Upload Videos</span>
              <input
                type="file"
                multiple
                accept="video/*"
                className="hidden"
                onChange={(e) => handleFileUpload(e, 'videos')}
              />
            </label>
          </div>
        )}

        {/* Music Selection */}
        {currentStep === 'music' && (
          <div className="bg-white rounded-lg shadow-md border border-gray-200 p-4">
            <div className="flex items-center mb-3">
              <Music className="w-5 h-5 text-purple-500 mr-2" />
              <h3 className="text-sm font-semibold text-gray-800">Select Background Music</h3>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {musicOptions.map((music) => (
                <button
                  key={music}
                  onClick={() => handleMusicSelection(music)}
                  className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition text-sm"
                >
                  {music}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Payment Section */}
        {currentStep === 'payment' && (
          <div className="flex justify-center">
            <button
              onClick={handlePayment}
              disabled={isLoading}
              className="flex items-center px-6 py-3 bg-green-500 text-white rounded-lg shadow-md hover:bg-green-600 transition disabled:opacity-50"
            >
              <CreditCard className="w-5 h-5 mr-2" />
              Proceed to Payment ($29.99)
            </button>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="bg-white border-t border-gray-200 p-4">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            disabled={isLoading || currentStep === 'photos' || currentStep === 'videos' || currentStep === 'music' || currentStep === 'payment'}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-800 disabled:bg-gray-100"
          />
          <button
            type="submit"
            disabled={isLoading || currentStep === 'photos' || currentStep === 'videos' || currentStep === 'music' || currentStep === 'payment'}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition disabled:opacity-50 flex items-center"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  );
}
