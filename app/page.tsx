import Link from "next/link";
import {
  ChatBubbleLeftRightIcon,
} from "@heroicons/react/24/outline";

export default function Home() {

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            DigitalOcean Gradient CUA Demo
          </h1>
          <p className="text-xl text-gray-600">
            Explore our Playwright automation tools
          </p>
        </div>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 max-w-2xl mx-auto">
          {/* Chat Card */}
          <Link href="/chat" className="group block no-underline">
            <div className="bg-white rounded-lg shadow-md hover:shadow-xl transition-all duration-300 p-8 h-full cursor-pointer transform hover:-translate-y-1">
              <div className="flex flex-col items-center text-center h-full">
                <div className="bg-green-100 rounded-full p-4 mb-4 group-hover:bg-green-200 transition-colors">
                  <ChatBubbleLeftRightIcon className="h-12 w-12 text-green-600" />
                </div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-3">
                  AI Chat with MCP
                </h2>
                <p className="text-gray-600 mb-4 flex-grow">
                  Chat with AI using Playwright MCP server for browser
                  automation
                </p>
                <div className="mt-auto">
                  <span className="text-green-600 font-medium group-hover:text-green-700 inline-flex items-center gap-1">
                    Start Chatting
                    <span className="transform group-hover:translate-x-1 transition-transform">
                      →
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
