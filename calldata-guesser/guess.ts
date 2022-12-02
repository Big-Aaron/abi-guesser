import { BytesLike, ethers } from 'ethers';
import { FunctionFragment } from '@ethersproject/abi/lib';
import { defaultAbiCoder, ParamType } from '@ethersproject/abi';

// check if a given bigint can safely be represented in a number
const isSafeNumber = (val: bigint): boolean => {
    return val < BigInt(Number.MAX_SAFE_INTEGER);
};

// try and parse an offset from the data
// returns the word as a number if it's a potentially valid offset into the data
const tryParseOffset = (data: Uint8Array, pos: number): number | null => {
    const bigOffset = BigInt(ethers.utils.hexlify(data.slice(pos, pos + 32)));

    // can't be huge
    if (!isSafeNumber(bigOffset)) return null;

    const offset = Number(bigOffset);

    // must be located in the correct region of calldata
    if (offset <= pos || offset >= data.length) return null;

    // must be a multiple of 32 (this might be too ambitious)
    if (offset % 32 !== 0) return null;

    return offset;
};

// try and parse a length from the data
// returns the word as a number if it's a potentially valid length for the data
const tryParseLength = (data: Uint8Array, offset: number): number | null => {
    const bigLength = BigInt(ethers.utils.hexlify(data.slice(offset, offset + 32)));

    // can't be huge
    if (!isSafeNumber(bigLength)) return null;

    const length = Number(bigLength);

    // must be valid
    if (offset + 32 + length > data.length) return null;

    return length;
};

// split a string into chunks of given length
const chunkString = (str: string, len: number): string[] => {
    const result: string[] = [];

    const size = Math.ceil(str.length / len);
    let offset = 0;

    for (let i = 0; i < size; i++) {
        result.push(str.substring(offset, offset + len));
        offset += len;
    }

    return result;
};

// count the number of leading zeros
const countLeadingZeros = (arr: Uint8Array) => {
    let count = 0;
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] != 0) break;

        count++;
    }
    return count;
};

// count the number of trailing zeros
const countTrailingZeros = (arr: Uint8Array) => {
    let count = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] != 0) break;

        count++;
    }
    return count;
};

// pretty print the potential param
const formatParams = (p: DecodedParam) => {
    // if (p === undefined) return 'undefined';

    if (ParamType.isParamType(p)) {
        return p.format();
    }

    return `dynamic(offset=${p.offset},len=${p.length})`;
};

// represents a placeholder for a potential dynamic variable
type DynamicPlaceholder = {
    // the offset of the dynamic variable. always exists
    offset: number;

    // the length of the dynamic variable. only exists sometimes, like for variable length arrays
    length: number | null;
}

export type DecodedParam = ParamType | DynamicPlaceholder;

type DynamicOnlyParams = {
    depth: number;
    assumeLength: boolean;
};

// decode a well formed tuple using backtracking
// for each parameter that we think we've identified, add it to collectedParams and backtrack
// this allows us to perform dfs through the entire search space without needing to implement the requisite data structure
const decodeWellFormedTuple = (
    // current depth, for debugging purposes
    depth: number,
    // the current data (calldata for top level, dynamic data if decoding a dynamic input)
    data: Uint8Array,
    // the current parameter being decoded
    paramIdx: number,
    // the total number of parameters identified
    collectedParams: Array<DecodedParam>,
    // the offset at which the static calldata ends
    endOfStaticCalldata: number,
    // some additional metadata only set if we're decoding a dynamic param
    dynamicOnlyParams: DynamicOnlyParams | null,
): FunctionFragment | null => {
    const debug = (msg: string, ...args: Array<any>) => {
        // console.log("  ".repeat(depth) + msg, ...args);
    };

    // check if the generated fragment is actually valid by attempting to decode the parameters
    // note that we need to actually check that the generated results are valid (we do this by calling toString)
    const testFragment = (fragment: FunctionFragment | null): fragment is FunctionFragment => {
        if (!fragment) return false;

        try {
            defaultAbiCoder.decode(fragment.inputs, data).map((v) => v.toString());
            return true;
        } catch (e) {
            debug('constructed illegal fragment!', fragment.format('full'), e);
            return false;
        }
    };

    const paramOffset = paramIdx * 32;

    if (paramOffset >= endOfStaticCalldata) {
        debug('reached end of static calldata, resolving dynamic variables', collectedParams.map(formatParams));

        const dynamicParams = collectedParams.filter((v): v is DynamicPlaceholder => !ParamType.isParamType(v));

        let dynamicParamIdx = -1;

        const finalParams = collectedParams.map((param) => {
            if (ParamType.isParamType(param)) return param; // not dynamic, no action

            // move to next dynamic param
            dynamicParamIdx++;

            // add 32 bytes to account for length if it exists
            const isTrailingDynamicParam = dynamicParamIdx === dynamicParams.length - 1;
            const dynamicDataStart =
                dynamicParams[dynamicParamIdx].offset + (dynamicParams[dynamicParamIdx].length === null ? 0 : 32);
            const dynamicDataEnd = isTrailingDynamicParam ? data.length : dynamicParams[dynamicParamIdx + 1].offset;
            let dynamicData = data.slice(dynamicDataStart, dynamicDataEnd);

            const maybeDynamicElementLen = dynamicParams[dynamicParamIdx].length;

            debug(
                `dynamic param ${dynamicParamIdx} is ${dynamicDataStart} -> ${dynamicDataEnd} (${dynamicData.length} bytes, ${maybeDynamicElementLen} elements)`,
            );

            if (maybeDynamicElementLen !== null) {
                debug(`could be tuple or string`);

                // can't do this yet because the consistency checker doesn't handle it properly
                // if (maybeDynamicElementLen === 0 && dynamicData.length === 0) {
                //     debug("empty data!!")
                //     return ParamType.from("()[]");
                // }

                // we're either decoding a bytes, or a dynamic array of a known size
                // we can disambiguate between the two by making use of the fact that if the encoded
                // data is not a bytes, then it must be at least 32 bytes per element
                const lastWord = Math.floor(maybeDynamicElementLen / 32) * 32;
                debug(
                    `lhs=${countTrailingZeros(dynamicData.slice(lastWord, lastWord + 32))} rhs=${32 - (maybeDynamicElementLen % 32)
                    }`,
                );
                if (
                    (maybeDynamicElementLen === 0 && dynamicData.length === 0) ||
                    (maybeDynamicElementLen > 0 &&
                        ((maybeDynamicElementLen % 32 === 0 &&
                            (isTrailingDynamicParam || maybeDynamicElementLen == dynamicData.length)) ||
                            countTrailingZeros(dynamicData.slice(lastWord, lastWord + 32)) >=
                            32 - (maybeDynamicElementLen % 32)))
                ) {
                    return ParamType.from('bytes');
                } else {
                    if (dynamicData.length / 32 > maybeDynamicElementLen) {
                        // there are more words than there are elements
                        // each element must have been dynamically encoded, therefore it
                        // must be a tuple or an array
                        debug('assuming element is a tuple/array');

                        // the tuples might be statically encoded, such as (uint256,address)[]
                        // they might also be dynamically encoded, such as (uint256,string)[]
                        // if they are dynamic, then each element will be an offset
                        // but if they are static, we will need to infer where the first tuple in the array
                        // ends and the second begins
                        const potentialOffsets = Array.from(Array(maybeDynamicElementLen).keys()).map((paramIdx) => {
                            return tryParseOffset(dynamicData, paramIdx * 32);
                        });

                        const elementsHaveOffsets = potentialOffsets.findIndex((offset) => offset === null) === -1;

                        if (elementsHaveOffsets) {
                            debug('tuple elements are dynamic and have offsets');

                            const decodedAssumingLength = decodeWellFormedTuple(
                                depth + 1,
                                dynamicData,
                                0,
                                [],
                                dynamicData.length,
                                {
                                    depth: depth + 1,
                                    assumeLength: true,
                                },
                            );
                            const decodedAssumingNoLength = decodeWellFormedTuple(
                                depth + 1,
                                dynamicData,
                                0,
                                [],
                                dynamicData.length,
                                {
                                    depth: depth + 1,
                                    assumeLength: false,
                                },
                            );

                            // if both decoded successfully, we want to use the one that assumes length
                            // because it is much less likely that it will succeed
                            // therefore, if it does, it's probably correct
                            const decodedToUse = decodedAssumingLength || decodedAssumingNoLength;

                            if (!decodedToUse) {
                                return undefined;
                            }

                            debug('decoded into', decodedToUse.format(''));

                            if (decodedToUse.inputs.length !== maybeDynamicElementLen) {
                                debug(
                                    'decoded array does not have expected number of elements',
                                    decodedToUse.inputs.length,
                                    maybeDynamicElementLen,
                                );
                                return undefined;
                            }

                            const allResults = new Set(decodedToUse.inputs.map(formatParams));
                            if (allResults.size !== 1) {
                                debug('got inconsistent params');
                                return undefined;
                            }

                            return ParamType.from(`${Array.from(allResults)[0]}[]`);
                        } else {
                            debug('tuple elements do not have offsets');

                            // the elements have no offsets, which means they're all statically sized
                            if ((dynamicData.length / 32) % maybeDynamicElementLen !== 0) {
                                if (!isTrailingDynamicParam) {
                                    // fail
                                    debug('got uneven dynamic data', dynamicData.length / 32, maybeDynamicElementLen);
                                    return undefined;
                                }
                                dynamicData = dynamicData.slice(
                                    0,
                                    Math.floor(dynamicData.length / 32 / maybeDynamicElementLen) *
                                    maybeDynamicElementLen *
                                    32,
                                );
                            }

                            const elemSizeWords = dynamicData.length / 32 / maybeDynamicElementLen;

                            const allResults = new Set();
                            for (let elemIdx = 0; elemIdx < maybeDynamicElementLen; elemIdx++) {
                                const fragment = decodeWellFormedTuple(
                                    depth + 1,
                                    dynamicData.slice(elemIdx * elemSizeWords * 32, (elemIdx + 1) * elemSizeWords * 32),
                                    0,
                                    [],
                                    elemSizeWords * 32,
                                    null,
                                );
                                if (!fragment) {
                                    debug('failed to decode element', elemIdx);
                                    return undefined;
                                }

                                allResults.add(`(${fragment.inputs.map(formatParams).join(',')})`);
                            }

                            debug('decoded tuple results', allResults);
                            if (allResults.size > 1) {
                                debug('got inconsistent results!');
                                return undefined;
                            }

                            return ParamType.from(`${Array.from(allResults)[0]}[]`);
                        }
                    }
                }
            }

            debug('trying to decode dynamic element', dynamicParamIdx, dynamicDataStart);
            const fragment = decodeWellFormedTuple(depth + 1, dynamicData, 0, [], dynamicData.length, null);
            if (fragment === null) {
                return undefined;
            }

            debug('decoded data', fragment.format('full'));

            let inputs = fragment.inputs;
            if (maybeDynamicElementLen !== null) {
                // if we have a length, we need to chunk the inputs manually
                if (inputs.length % maybeDynamicElementLen !== 0) {
                    debug(`got uneven results: ${inputs.length} ${maybeDynamicElementLen}`);
                    return undefined;
                }

                const numPerElement = inputs.length / maybeDynamicElementLen;
                const chunks = [];
                for (let i = 0; i < maybeDynamicElementLen; i++) {
                    chunks.push(inputs.slice(i * numPerElement, (i + 1) * numPerElement));
                }

                if (new Set(chunks.map((v) => v.map(formatParams).join(','))).size !== 1) {
                    debug('got inconsistent results');
                    return undefined;
                }

                const result = chunks[0];
                if (result.length === 1) {
                    if (result[0].type === 'bytes') {
                        return result[0];
                    } else {
                        return ParamType.from(`${result[0].format()}[]`);
                    }
                }

                return ParamType.from(`(${result.map((v) => v.format()).join(',')})[]`);
            }

            return ParamType.from(`(${inputs.map((v) => v.format()).join(',')})`);
        });

        const filteredParams = finalParams.filter((v): v is ParamType => v !== undefined);

        if (finalParams.length !== filteredParams.length) {
            // we failed
            debug('failed to resolve dynamic types');
            return null;
        }

        debug('resolved params', filteredParams.map(formatParams));

        const fragment = FunctionFragment.from(`guessed(${filteredParams.map(formatParams).join(', ')})`);
        if (testFragment(fragment)) {
            return fragment;
        }
        return null;
    }

    if (paramIdx === 0) {
        debug('backtracking');
        debug('input:');
        chunkString(ethers.utils.hexlify(data).substring(2), 64).forEach((v, i) =>
            debug('  ' + i.toString(16) + ' => ' + v),
        );
    }

    // first, check if this parameter is dynamic
    // if it's dynamic, it should be an offset into calldata
    const maybeOffset = tryParseOffset(data, paramOffset);
    if (maybeOffset !== null) {
        const maybeLength = tryParseLength(data, maybeOffset);

        debug(
            `parameter ${paramIdx} might be dynamic, got offset ${maybeOffset}, len ${maybeLength}, ${depth}, ${dynamicOnlyParams}`,
        );

        if (
            maybeLength !== null &&
            (dynamicOnlyParams === null || (depth === dynamicOnlyParams.depth && dynamicOnlyParams.assumeLength))
        ) {
            const fragment = decodeWellFormedTuple(
                depth,
                data,
                paramIdx + 1,
                [...collectedParams, { offset: maybeOffset, length: maybeLength }],
                Math.min(endOfStaticCalldata, maybeOffset),
                dynamicOnlyParams,
            );
            if (testFragment(fragment)) {
                return fragment;
            }
        }

        if (dynamicOnlyParams === null || (depth === dynamicOnlyParams.depth && !dynamicOnlyParams.assumeLength)) {
            const fragment = decodeWellFormedTuple(
                depth,
                data,
                paramIdx + 1,
                [...collectedParams, { offset: maybeOffset, length: null }],
                Math.min(endOfStaticCalldata, maybeOffset),
                dynamicOnlyParams,
            );
            if (testFragment(fragment)) {
                return fragment;
            }
        }
    }

    // only assume it's static if we're allowed to
    if (dynamicOnlyParams !== null && depth === dynamicOnlyParams.depth) {
        return null;
    }

    const fragment = decodeWellFormedTuple(
        depth,
        data,
        paramIdx + 1,
        [...collectedParams, ParamType.from('bytes32')],
        endOfStaticCalldata,
        dynamicOnlyParams,
    );
    if (testFragment(fragment)) {
        return fragment;
    }

    return null;
};

/*
assume the calldata is "well-formed". by well-formed, we mean that all the static parameters come first,
then all the dynamic parameters come after. we assume there is no overlaps in dynamic parameters
and all trailing zeros are explicitly specified
 */
const wellFormedParse = (sig: Uint8Array, bytes: Uint8Array): FunctionFragment | null => {
    const fragment = decodeWellFormedTuple(0, bytes, 0, [], bytes.length, null);
    if (!fragment) {
        return null;
    }

    // let's clean it up
    const mergeTypes = (types: Array<ParamType>): ParamType => {
        if (types.length === 0) {
            return ParamType.from('()');
        }

        if (types.find((v) => v.baseType === 'tuple') !== undefined) {
            const componentTypes = [];
            for (let i = 0; i < types[0].components.length; i++) {
                componentTypes.push(
                    mergeTypes(Array.from(Array(types.length).keys()).map((v) => types[v].components[i])),
                );
            }
            return ParamType.from(`(${componentTypes.map((v) => v.format()).join(',')})`);
        }
        if (types.find((v) => v.baseType === 'array') !== undefined) {
            return ParamType.from(`${mergeTypes(types.map((v) => v.arrayChildren)).format()}[]`);
        }

        const set = new Set(types.map((v) => v.format()));
        if (set.size === 1) {
            return types[0];
        } else {
            if (set.has('bytes')) {
                return ParamType.from('bytes');
            } else if (set.has('uint256')) {
                return ParamType.from('uint256');
            } else {
                return ParamType.from('bytes32');
            }
        }
    };

    const prettyTypes = (params: Array<ParamType>, vals: Array<any>): Array<ParamType> => {
        return params.map((param, idx) => {
            const val = vals[idx];

            if (param.type === 'bytes32') {
                const leadingZeros = countLeadingZeros(ethers.utils.arrayify(val));
                const trailingZeros = countTrailingZeros(ethers.utils.arrayify(val));

                if (leadingZeros >= 12 && leadingZeros <= 17) {
                    // it's probably very hard to mine more leading zeros than that
                    return ParamType.from('address');
                } else if (leadingZeros > 16) {
                    return ParamType.from('uint256');
                } else if (trailingZeros > 0) {
                    return ParamType.from(`bytes${32 - trailingZeros}`);
                } else {
                    return ParamType.from('bytes32');
                }
            } else if (param.type === 'bytes') {
                try {
                    ethers.utils.toUtf8String(val);
                    return ParamType.from('string');
                } catch {
                    return ParamType.from('bytes');
                }
            } else if (param.baseType === 'array') {
                const childrenTypes = val.map((child: any) => prettyTypes([param.arrayChildren], [child])[0]);
                return ParamType.from(`${mergeTypes(childrenTypes).format()}[]`);
            } else if (param.baseType === 'tuple') {
                return ParamType.from(
                    `(${prettyTypes(param.components, val)
                        .map((v) => v.format())
                        .join(',')})`,
                );
            } else {
                return param;
            }
        });
    };

    return FunctionFragment.from(
        `guessed_${ethers.utils.hexlify(sig).substring(2)}(${prettyTypes(
            fragment.inputs,
            Array.from(defaultAbiCoder.decode(fragment.inputs, bytes)),
        )
            .map((v) => v.format())
            .join(',')})`,
    );
};

export const guessFragment = (calldata: BytesLike): FunctionFragment | null => {
    const bytes = ethers.utils.arrayify(calldata);
    if (bytes.length === 0) return null;

    return wellFormedParse(bytes.slice(0, 4), bytes.slice(4));
};
