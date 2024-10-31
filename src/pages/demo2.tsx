import type { NextPage } from 'next'
import dynamic from 'next/dynamic'
import IMFClient from '@/components/IMFClient';


const Demo2: NextPage = () => {


  return (
    <div className="min-h-screen p-4">
      <h1 className="text-2xl font-bold mb-4">TensorFlow.js Next.js Demo</h1>
        <IMFClient /> 
    </div>
  )
}

export default Demo2