import asyncio
import json
import ssl
import websockets
import os
import time

import gi
gi.require_version('Gst', '1.0')
gi.require_version('GstWebRTC', '1.0')
gi.require_version('GstSdp', '1.0')
from gi.repository import Gst, GstWebRTC, GstSdp, GLib

Gst.init(None)

# WebSocket configuration
HOST_URL= "ws://10.33.12.42:8766"
PIPELINE_DESC = '''
webrtcbin name=sendrecv bundle-policy=max-bundle stun-server=stun://stun.l.google.com:19302
'''

VIDEO_SOURCES = [
    "/base/axi/pcie@1000120000/rp1/i2c@80000/ov5647@36",
    "/base/axi/pcie@1000120000/rp1/i2c@88000/ov5647@36"
]

async def glib_main_loop_iteration():
    while True:
        while GLib.main_context_default().iteration(False):
            pass
        await asyncio.sleep(0.01)

class WebRTCClient:
    def __init__(self, loop):
        self.pipe = None
        self.webrtc = None
        self.ws = None
        self.loop = loop
        self.added_data_channel = False
        self.connection_state = "new"
        self.cleanup_timeout = None

    def reset_state(self):
        """Reset all connection-related state"""
        print("Resetting WebRTC client state")
        self.added_data_channel = False
        self.connection_state = "new"
        if self.cleanup_timeout:
            self.cleanup_timeout.cancel()
            self.cleanup_timeout = None

    def start_pipeline(self):
        print("Starting pipeline")
        
        # Clean up any existing pipeline first
        self.close_pipeline()
        self.reset_state()
        
        self.pipe = Gst.Pipeline.new("pipeline")
        webrtc = Gst.parse_launch(PIPELINE_DESC)
        self.pipe.add(webrtc)
        
        bus = self.pipe.get_bus()
        bus.add_signal_watch()
        bus.connect("message", self.on_bus_message)
        
        self.webrtc = self.pipe.get_by_name("sendrecv")
        self.webrtc.set_property("latency", 200)
        
        # Connect WebRTC signals
        self.webrtc.connect("on-ice-candidate", self.send_ice_candidate_message)
        self.webrtc.connect("on-negotiation-needed", self.on_negotiation_needed)
        self.webrtc.connect("on-connection-state-changed", self.on_connection_state_changed)
        
        # Add video sources dynamically
        for i in range(0, 2):
            cam_name = VIDEO_SOURCES[i]
            src = Gst.ElementFactory.make("libcamerasrc", f"libcamerasrc{i}")
            src.set_property("camera-name", cam_name)
            print(f"Camera {i} name:", src.get_property("camera-name"))
            
            caps = Gst.Caps.from_string("video/x-raw,format=YUY2, framerate=30/1")
            capsfilter = Gst.ElementFactory.make("capsfilter", f"caps{i}")
            capsfilter.set_property("caps", caps)
            
            conv = Gst.ElementFactory.make("videoconvert", f"conv{i}")
            queue = Gst.ElementFactory.make("queue", f"queue{i}")
            queue.set_property("leaky", 1)
            queue.set_property("max-size-buffers", 1)
            
            vp8enc = Gst.ElementFactory.make("vp8enc", f"vp8enc{i}")
            vp8enc.set_property("deadline", 1)
            vp8enc.set_property("cpu-used", 8)  # Faster encoding
            vp8enc.set_property("target-bitrate", 1000000)  # 1Mbps
            
            pay = Gst.ElementFactory.make("rtpvp8pay", f"pay{i}")
            pay.set_property("pt", 96+i)
            
            # Add all elements to pipeline
            elements = [src, capsfilter, conv, queue, vp8enc, pay]
            for element in elements:
                self.pipe.add(element)
            
            # Link elements
            src.link(capsfilter)
            capsfilter.link(conv)
            conv.link(queue)
            queue.link(vp8enc)
            vp8enc.link(pay)
            
            # Add transceiver
            caps = pay.get_static_pad("src").get_current_caps()
            transceiver = webrtc.emit(
                "add-transceiver",
                GstWebRTC.WebRTCRTPTransceiverDirection.SENDONLY,
                caps
            )
            
            # Link to webrtcbin
            sink_pad = webrtc.get_request_pad(f"sink_{i}")
            if sink_pad:
                src_pad = pay.get_static_pad("src")
                ret = src_pad.link(sink_pad)
                print(f"Stream {i} pad link result:", ret)
            else:
                print(f"Failed to get sink pad for stream {i}")

        print("Setting pipeline to PLAYING state")
        ret = self.pipe.set_state(Gst.State.PLAYING)
        if ret == Gst.StateChangeReturn.FAILURE:
            print("Failed to start pipeline")
            return False
        
        print("Pipeline started successfully")
        return True

    def on_connection_state_changed(self, webrtc, state):
        """Handle WebRTC connection state changes"""
        old_state = self.connection_state
        self.connection_state = state.value_name
        print(f"WebRTC connection state changed: {old_state} -> {self.connection_state}")
        
        if state == GstWebRTC.WebRTCPeerConnectionState.FAILED:
            print("WebRTC connection failed, scheduling cleanup")
            self.schedule_cleanup()
        elif state == GstWebRTC.WebRTCPeerConnectionState.DISCONNECTED:
            print("WebRTC disconnected, scheduling cleanup")
            self.schedule_cleanup()
        elif state == GstWebRTC.WebRTCPeerConnectionState.CONNECTED:
            print("WebRTC connected successfully")
            # Cancel any pending cleanup
            if self.cleanup_timeout:
                self.cleanup_timeout.cancel()
                self.cleanup_timeout = None

    def schedule_cleanup(self):
        """Schedule pipeline cleanup after a delay"""
        if self.cleanup_timeout:
            self.cleanup_timeout.cancel()
        
        async def delayed_cleanup():
            await asyncio.sleep(5)  # Wait 5 seconds before cleanup
            print("Performing scheduled cleanup")
            self.close_pipeline()
            self.reset_state()
        
        self.cleanup_timeout = asyncio.create_task(delayed_cleanup())

    def on_bus_message(self, bus, message):
        """Handle messages from the GStreamer bus"""
        t = message.type
        
        if t == Gst.MessageType.LATENCY:
            print("Recalculating latency")
            self.pipe.recalculate_latency()
        elif t == Gst.MessageType.ERROR:
            err, debug = message.parse_error()
            print(f"Pipeline error: {err.message}")
            print(f"Debug info: {debug}")
        elif t == Gst.MessageType.WARNING:
            warn, debug = message.parse_warning()
            print(f"Pipeline warning: {warn.message}")
        elif t == Gst.MessageType.STATE_CHANGED:
            if message.src == self.pipe:
                old_state, new_state, pending_state = message.parse_state_changed()
                print(f"Pipeline state changed: {old_state.value_name} -> {new_state.value_name}")

        return GLib.SOURCE_CONTINUE

    def close_pipeline(self):
        """Properly close and cleanup the pipeline"""
        if self.pipe:
            print("Closing pipeline")
            # Stop the pipeline gracefully
            self.pipe.set_state(Gst.State.NULL)
            
            # Wait for state change to complete
            ret, state, pending = self.pipe.get_state(Gst.CLOCK_TIME_NONE)
            if ret == Gst.StateChangeReturn.SUCCESS:
                print("Pipeline stopped successfully")
            else:
                print("Pipeline stop may have failed")
            
            # Clean up bus
            bus = self.pipe.get_bus()
            bus.remove_signal_watch()
            
            self.pipe = None
            self.webrtc = None

    def on_negotiation_needed(self, element):
        print("Negotiation needed")
        if self.added_data_channel:
            print("Data channel already added, skipping")
            return
        
        self.added_data_channel = True
        promise = Gst.Promise.new_with_change_func(self.on_offer_created, element, None)
        self.webrtc.emit("create-offer", None, promise)

    def on_offer_created(self, promise, _, __):
        print("Offer created")
        promise.wait()
        reply = promise.get_reply()
        
        if not reply:
            print("Failed to create offer")
            return
            
        offer = reply.get_value("offer")
        if not offer:
            print("No offer in reply")
            return
            
        print("Setting local description")
        self.webrtc.emit("set-local-description", offer, Gst.Promise.new())
        
        text = offer.sdp.as_text()
        message = json.dumps({'sdp': {'type': 'offer', 'sdp': text}})
        
        if self.ws and not self.ws.closed:
            asyncio.run_coroutine_threadsafe(self.ws.send(message), self.loop)
        else:
            print("WebSocket not available to send offer")

    def send_ice_candidate_message(self, _, mlineindex, candidate):
        message = json.dumps({
            'ice': {'candidate': candidate, 'sdpMLineIndex': mlineindex}
        })
        
        if self.ws and not self.ws.closed:
            asyncio.run_coroutine_threadsafe(self.ws.send(message), self.loop)
        else:
            print("WebSocket not available to send ICE candidate")

    def handle_client_message(self, message):
        """Handle incoming WebSocket messages"""
        try:
            msg = json.loads(message)
            print(f"Received message: {msg.get('type', 'unknown')}")
            
            if msg.get("type") == "HELLO":
                print("Received HELLO, starting new pipeline")
                success = self.start_pipeline()
                if not success:
                    print("Failed to start pipeline")
                return
                
            if 'sdp' in msg and msg['sdp']['type'] == 'answer':
                if not self.webrtc:
                    print("No webrtc element to handle answer")
                    return
                    
                sdp = msg['sdp']['sdp']
                print("Processing SDP answer")
                res, sdpmsg = GstSdp.SDPMessage.new()
                GstSdp.sdp_message_parse_buffer(sdp.encode(), sdpmsg)
                answer = GstWebRTC.WebRTCSessionDescription.new(GstWebRTC.WebRTCSDPType.ANSWER, sdpmsg)
                self.webrtc.emit("set-remote-description", answer, Gst.Promise.new())
                
            elif 'ice' in msg:
                if not self.webrtc:
                    print("No webrtc element to handle ICE candidate")
                    return
                    
                ice = msg['ice']
                print(f"Adding ICE candidate: {ice['candidate']}")
                self.webrtc.emit("add-ice-candidate", ice['sdpMLineIndex'], ice['candidate'])
                
        except json.JSONDecodeError as e:
            print(f"Failed to parse JSON message: {e}")
        except Exception as e:
            print(f"Error handling client message: {e}")

    async def connect_websocket(self):
        """Connect to WebSocket server and handle messages"""
        retry_count = 0
        max_retries = 5
        
        while retry_count < max_retries:
            try:
                print(f"Connecting to {HOST_URL} (attempt {retry_count + 1})")
                async with websockets.connect(HOST_URL, ping_interval=20, ping_timeout=10) as websocket:
                    print("Connected to WebSocket server")
                    self.ws = websocket
                    retry_count = 0  # Reset retry count on successful connection
                    
                    # Send initial registration message
                    await websocket.send(json.dumps({"role": "robot", "robot_id": "box"}))
                    
                    async for message in websocket:
                        self.handle_client_message(message)
                        
            except websockets.exceptions.ConnectionClosed:
                print("WebSocket connection closed")
                break
            except websockets.exceptions.InvalidStatusCode as e:
                print(f"WebSocket connection failed with status {e.status_code}")
                retry_count += 1
                if retry_count < max_retries:
                    wait_time = min(2 ** retry_count, 30)  # Exponential backoff, max 30s
                    print(f"Retrying in {wait_time} seconds...")
                    await asyncio.sleep(wait_time)
            except Exception as e:
                print(f"WebSocket error: {e}")
                retry_count += 1
                if retry_count < max_retries:
                    wait_time = min(2 ** retry_count, 30)
                    print(f"Retrying in {wait_time} seconds...")
                    await asyncio.sleep(wait_time)
                    
        print("Max retries reached, giving up")
        self.close_pipeline()

async def main():
    loop = asyncio.get_running_loop()
    client = WebRTCClient(loop)
    
    # Start the GLib main loop iteration task
    asyncio.create_task(glib_main_loop_iteration())
    
    try:
        # Connect to the WebSocket server
        await client.connect_websocket()
    except KeyboardInterrupt:
        print("Shutting down...")
    finally:
        client.close_pipeline()

if __name__ == "__main__":
    asyncio.run(main())
