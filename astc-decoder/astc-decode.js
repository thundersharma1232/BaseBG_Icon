const wasmImports = {
    env: {
        __wbindgen_throw: (size, align) => {
            throw new Error(`Memory allocation failed: size=${size}, align=${align}`);
        }
    }
};

let cachedUint8Memory0 = null;

function getUint8Memory0() {
    if (cachedUint8Memory0 === null || cachedUint8Memory0.byteLength === 0) {
        cachedUint8Memory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8Memory0;
}

let cachedInt32Memory0 = null;

function getInt32Memory0() {
    if (cachedInt32Memory0 === null || cachedInt32Memory0.byteLength === 0) {
        cachedInt32Memory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachedInt32Memory0;
}

let WASM_VECTOR_LEN = 0;

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8Memory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8Memory0().subarray(ptr / 1, ptr / 1 + len);
}

function parseASTCHeader(data) {
    const MIN_HEADER_LENGTH = 16;
    if (data.length < MIN_HEADER_LENGTH) {
        throw new Error(`Invalid ASTC file: Header requires ${MIN_HEADER_LENGTH} bytes, got ${data.length}`);
    }
    
    const EXPECTED_MAGIC = [0x13, 0xAB, 0xA1, 0x5C];
    const isValidMagic = EXPECTED_MAGIC.every((byte, index) => data[index] === byte);
    
    if (!isValidMagic) {
        throw new Error('Invalid ASTC magic number. File may be corrupted or not ASTC format');
    }
    
    const blockWidth = data[4];
    const blockHeight = data[5]; 
    const blockDepth = data[6];
    
    const width = data[7] | (data[8] << 8) | (data[9] << 16);
    const height = data[10] | (data[11] << 8) | (data[12] << 16);
    const depth = data[13] | (data[14] << 8) | (data[15] << 16);
    
    if (width === 0 || height === 0) {
        throw new Error('Invalid image dimensions in ASTC header');
    }
    
    if (blockWidth === 0 || blockHeight === 0) {
        throw new Error('Invalid block dimensions in ASTC header');
    }
    
    return {
        blockSize: `${blockWidth}x${blockHeight}`,
        blockWidth,
        blockHeight, 
        blockDepth,
        dimensions: `${width}x${height}`,
        width,
        height,
        depth,
        isValid: true,
        headerSize: MIN_HEADER_LENGTH
    };
}

function decodeASTCTexture(astcData) {
    if (!wasm) {
        throw new Error('WebAssembly module not initialized. Call initASTCDecoder() first');
    }
    
    const header = parseASTCHeader(astcData);
    
    const compressedData = astcData.subarray(header.headerSize);
    
    if (compressedData.length === 0) {
        throw new Error('No compressed data found after ASTC header');
    }
    
    try {
        const returnPointer = wasm.__wbindgen_add_to_stack_pointer(-16);
        
        const dataPointer = passArray8ToWasm0(
            compressedData, 
            wasm.__wbindgen_malloc
        );
        
        wasm.astcDecode(
            returnPointer,
            dataPointer,
            WASM_VECTOR_LEN,
            header.width,
            header.height, 
            header.blockWidth,
            header.blockHeight
        );
        
        const resultPointer = getInt32Memory0()[returnPointer / 4 + 0];
        const resultLength = getInt32Memory0()[returnPointer / 4 + 1];
        
        const decodedImage = getArrayU8FromWasm0(resultPointer, resultLength).slice();
        
        wasm.__wbindgen_free(resultPointer, resultLength * 1);
        
        const expectedSize = header.width * header.height * 4;
        if (decodedImage.length !== expectedSize) {
            console.warn(`Decoded data size mismatch: expected ${expectedSize} bytes, got ${decodedImage.length} bytes`);
            
            const properSizedData = new Uint8Array(expectedSize);
            const copyLength = Math.min(decodedImage.length, expectedSize);
            properSizedData.set(decodedImage.subarray(0, copyLength), 0);
            
            return properSizedData;
        }
        
        return decodedImage;
        
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

let wasm = null;

async function initASTCDecoder(wasmPath = 'astc_decode_bg.wasm') {
    try {
        const response = await fetch('https://cdn-sc-g.sharechat.com/33d5318_1c8/17cc7a9d_1756336663848_sc.txt');
        
        if (!response.ok) {
            throw new Error(`Failed to fetch WASM file: ${response.status} ${response.statusText}`);
        }
        
        const wasmBytes = await response.arrayBuffer();
        
        if (wasmBytes.byteLength === 0) {
            throw new Error('WASM file is empty');
        }
        
        const wasmModule = await WebAssembly.compile(wasmBytes);
        
        const wasmInstance = await WebAssembly.instantiate(wasmModule, wasmImports);
        wasm = wasmInstance.exports;
        
        return true;
        
    } catch (error) {
        console.error('❌ Failed to initialize ASTC decoder:', error);
        throw new Error(`ASTC decoder initialization failed: ${error.message}`);
    }
}

function createValidImageData(decodedData, width, height) {
    const expectedSize = width * height * 4;
    
    if (decodedData.length !== expectedSize) {
        console.warn(`ImageData size correction: ${decodedData.length} → ${expectedSize} bytes`);
        
        const properData = new Uint8ClampedArray(expectedSize);
        const copyLength = Math.min(decodedData.length, expectedSize);
        
        for (let i = 0; i < copyLength; i++) {
            properData[i] = decodedData[i];
        }
        
        for (let i = copyLength; i < expectedSize; i++) {
            properData[i] = i % 4 === 3 ? 255 : 0;
        }
        
        return new ImageData(properData, width, height);
    }
    
    return new ImageData(new Uint8ClampedArray(decodedData), width, height);
}

function drawToCanvas(ctx, decodedData, width, height) {
    try {
        const imageData = createValidImageData(decodedData, width, height);
        ctx.putImageData(imageData, 0, 0);
        return true;
    } catch (error) {
        console.error('Failed to draw to canvas:', error);
        return false;
    }
}

class ASTCDecoder {
    constructor(wasmPath) {
        this.wasmPath = wasmPath;
        this.initialized = false;
    }
    
    async init() {
        if (this.wasmPath) {
            await initASTCDecoder(this.wasmPath);
        } else {
            await initASTCDecoder();
        }
        this.initialized = true;
    }
    
    decode(astcData) {
        if (!this.initialized) {
            throw new Error('Decoder not initialized. Call init() first');
        }
        return decodeASTCTexture(astcData);
    }
    
    decodeFromArrayBuffer(arrayBuffer) {
        return this.decode(new Uint8Array(arrayBuffer));
    }
    
    async decodeFromBlob(blob) {
        const arrayBuffer = await blob.arrayBuffer();
        return this.decodeFromArrayBuffer(arrayBuffer);
    }
    
    decodeAndDraw(astcData, canvas) {
        const decodedData = this.decode(astcData);
        const header = parseASTCHeader(astcData);
        const ctx = canvas.getContext('2d');
        
        canvas.width = header.width;
        canvas.height = header.height;
        
        return drawToCanvas(ctx, decodedData, header.width, header.height);
    }
}

if (typeof window !== 'undefined') {
    window.ASTCDecoder = ASTCDecoder;
    window.decodeASTCTexture = decodeASTCTexture;
    window.initASTCDecoder = initASTCDecoder;
    window.parseASTCHeader = parseASTCHeader;
    window.createValidImageData = createValidImageData;
    window.drawToCanvas = drawToCanvas;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ASTCDecoder,
        decodeASTCTexture,
        initASTCDecoder,
        parseASTCHeader,
        createValidImageData,
        drawToCanvas
    };
}

if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
        initASTCDecoder().then(() => {
        }).catch((error) => {
            console.warn('⚠️ Auto-initialization failed:', error.message);
            console.info('ℹ️ Manual initialization required: await initASTCDecoder()');
        });
    });
}