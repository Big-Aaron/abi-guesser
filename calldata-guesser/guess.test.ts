import { defaultAbiCoder, FunctionFragment, ParamType } from '@ethersproject/abi';
import { BigNumber, ethers } from 'ethers';
import { guessFragment } from './guess';

const jestConsole = console;

beforeEach(() => {
    global.console = require('console');
});

afterEach(() => {
    global.console = jestConsole;
});

const testCases: Array<[string, string, Array<any>]> = [
    ['uint', 'test(uint256)', [123]],
    ['bytes32', 'test(bytes32)', ['0xaabbccddeeffaabbccddeeffaabbccddeeffaabbccddeeffaabbccddeeffaabb']],
    ['bytes4', 'test(bytes4)', ['0xabcdabcd']],
    ['uint fixed array', 'test(uint256[5])', [[123, 456, 789, 420, 69]]],
    ['uint dynamic array', 'test(uint256[])', [[123, 456, 789, 420, 69]]],
    ['bytes', 'test(bytes)', ['0x69696969123412341234']],
    ['string', 'test(string)', ['hello world! this is a really long string']],
    ['single uint array', 'test(uint256[])', [[BigNumber.from(2).pow(255)]]],
    ['single byte', 'test(bytes)', ['0x80']],
    ['tuple', 'test((uint256 a, uint256 b, bytes4 c))', [[10, 20, '0x69696969']]],
    [
        'tuple array',
        'test((uint256 a, uint256 b, bytes4 c)[])',
        [
            [
                [10, 20, '0x69696969'],
                [0x1234, 0x4321, '0xcafebabe'],
            ],
        ],
    ],
    [
        'array in tuple array',
        'test((string, uint256)[])',
        [
            [
                ['alice', 0x1234],
                ['bob', 0x4321],
            ],
        ],
    ],
    ['array of tuple of string', 'test((string)[])', [[['alice'], ['bob']]]],
    ['array of strings', 'test(string[])', [['hello', 'world']]],
    [
        'array of tuple of two string',
        'test((string, uint256[])[])',
        [
            [
                ['alice', [1, 2, 3]],
                ['bob', [4, 5, 6]],
            ],
        ],
    ],
    [
        'array of tuple of two string',
        'test((string, (string, uint256)[])[])',
        [
            [
                [
                    'alice',
                    [
                        ['microsoft', [1, 2, 3]],
                        ['windows', [5, 5, 5]],
                    ],
                ],
                [
                    'bob',
                    [
                        ['apple', [4, 5, 6]],
                        ['osx', [4, 5, 6]],
                    ],
                ],
            ],
        ],
    ],
    [
        'dydx',
        'test((address,uint256)[])',
        [
            [
                ['0x646703824cDb020D4E16b278808AbB22432eaeE0', 1],
                ['0x646703824cDb020D4E16b278808AbB22432eaeE0', 2],
            ],
        ],
    ],
    [
        'dydx',
        'test((address,uint256)[],(uint8,uint256,(bool,uint256,uint256,uint256),uint256,uint256,address,uint256,bytes)[])',
        [
            [
                ['0x646703824cDb020D4E16b278808AbB22432eaeE0', 1],
                ['0x646703824cDb020D4E16b278808AbB22432eaeE0', 2],
            ],
            [
                [
                    0x69,
                    0xfeedfeed,
                    [false, 0xcafebabe, 0xdeadbeef, 0xf00df00d],
                    0xabcdabcd,
                    0x13371337,
                    '0x646703824cDb020D4E16b278808AbB22432eaeE0',
                    0xdeaddead,
                    '0x1234567812345678',
                ],
                [
                    0x69,
                    0xfeedfeed,
                    [false, 0xcafebabe, 0xdeadbeef, 0xf00df00d],
                    0xabcdabcd,
                    0x13371337,
                    '0x646703824cDb020D4E16b278808AbB22432eaeE0',
                    0xdeaddead,
                    '0x1234567812345678',
                ],
            ],
        ],
    ],
    [
        'test',
        'test((address,string)[])',
        [
            [
                ['0x646703824cDb020D4E16b278808AbB22432eaeE0', 'abc'],
                ['0x646703824cDb020D4E16b278808AbB22432eaeE0', 'def'],
            ],
        ],
    ],
    ['empty', 'test(bytes32[])', [[]]],
    [
        '2d tuple array',
        'test((uint256,uint8,uint256,uint256,bytes32[])[],(uint256,uint256)[][])',
        [
            [],
            [
                [
                    // [
                    [0xaabb, 0xccdd],
                    [0x1234, 0x5678],
                    // ]
                ],
                [
                    // [
                    [0xffff, 0xeeee],
                    [0xdddd, 0xcccc],
                    // ],
                ],
            ],
        ],
    ],
];

const isEqual = (expectedFragment: FunctionFragment, actualFragment: FunctionFragment) => {
    // first, collapse tuples and arrays in expected because they're semantically identical
    // to just being inlined directly
    const mustBeTuple = (params: Array<ParamType>) => {
        if (params.length > 1) {
            return ParamType.from(`(${params.map((v) => v.format()).join(',')})`);
        }
        return params[0];
    };

    const remapParams = (params: Array<ParamType>): Array<ParamType> => {
        const flattenedComponents: Array<ParamType> = [];
        params.forEach((param, i) => {
            if (param.baseType === 'array') {
                if (param.arrayLength === -1) {
                    flattenedComponents.push(ParamType.from(`${remapParams([param.arrayChildren])[0].format()}[]`));
                } else {
                    for (let i = 0; i < param.arrayLength; i++) {
                        flattenedComponents.push(param.arrayChildren);
                    }
                }
            } else if (param.baseType === 'tuple') {
                if (params.length !== 1) {
                    param.components.forEach((v) => flattenedComponents.push(mustBeTuple(remapParams([v]))));
                } else {
                    flattenedComponents.push(
                        ParamType.from(
                            `(${remapParams(param.components)
                                .map((v) => v.format())
                                .join(',')})`,
                        ),
                    );
                }
            } else {
                flattenedComponents.push(param);
            }
        });

        return flattenedComponents;
    };
    const remappedExpectedFragment = FunctionFragment.from(
        `${expectedFragment.name}(${remapParams(expectedFragment.inputs)
            .map((v) => v.format())
            .join(',')})`,
    );

    const normalize = (type: string) => {
        if (/^uint[0-9]+$/g.test(type)) return 'uint256';
        else if (/^int[0-9]+$/g.test(type)) return 'int256';
        else if (type === 'bool') return 'uint256';
        else if (type === 'string') return 'bytes';

        return type;
    };

    const compareParams = (left: Array<ParamType>, right: Array<ParamType>) => {
        if (left.length !== right.length) {
            throw new Error(`${left.length} != ${right.length}`);
        }

        for (let i = 0; i < left.length; i++) {
            const leftChild = left[i];
            const rightChild = right[i];

            if (leftChild.baseType === 'array') {
                if (leftChild.baseType !== rightChild.baseType) {
                    throw new Error(`${leftChild.baseType} != ${rightChild.baseType}`);
                }

                if (leftChild.arrayLength != rightChild.arrayLength) {
                    throw new Error(`${leftChild.arrayLength} != ${rightChild.arrayLength}`);
                }
                compareParams([leftChild.arrayChildren], [rightChild.arrayChildren]);
            } else if (leftChild.baseType === 'tuple') {
                if (leftChild.baseType !== rightChild.baseType) {
                    throw new Error(`${leftChild.baseType} != ${rightChild.baseType}`);
                }

                compareParams(leftChild.components, rightChild.components);
            } else {
                const leftType = normalize(leftChild.type);
                const rightType = normalize(rightChild.type);

                if (leftType !== rightType) {
                    throw new Error(`${leftChild.type} !== ${rightChild.type}`);
                }
            }
        }
    };

    console.log('comparing', remappedExpectedFragment.format(), actualFragment.format());

    compareParams(remappedExpectedFragment.inputs, actualFragment.inputs);
};

describe('guess', () => {
    testCases.forEach(([name, sig, args]) => {
        it('should work on ' + name, async () => {
            console.log();
            const fragment = FunctionFragment.from(sig);
            const abi = new ethers.utils.Interface([fragment]);
            const data = abi.encodeFunctionData(fragment, args);

            const guessed = guessFragment(data);
            if (!guessed) {
                throw new Error('failed to parse');
            }

            // console.log(chunkString(data.substring(10), 64).map((v, i) => i + " => " + v).join("\n"))
            // console.log(data);
            console.log('expected function', fragment.format());
            console.log('guessed function', guessed.format());
            console.log(defaultAbiCoder.decode(guessed.inputs, '0x' + data.substring(10)));
            try {
                isEqual(fragment, guessed);
            } catch (e) {
                console.log('failed', e);
                throw e;
            }
        });
    });
    // it('should handle', async () => {
    //     // const data = "0xa67a6a45000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000646703824cdb020d4e16b278808abb22432eaee000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000001c800000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000045d964b80000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000646703824cdb020d4e16b278808abb22432eaee000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000646703824cdb020d4e16b278808abb22432eaee0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000001920800000000000000000000000000000000000000000000000000000000491f2c0000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000017e0800000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000044095ea7b30000000000000000000000001111111254fb6c44bac0bed2854e76f90643097d00000000000000000000000000000000000000000000000000000045d964b800000000000000000000000000000000000000000000000000000000008000000000000000000000001111111254fb6c44bac0bed2854e76f90643097d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000016047c025200000000000000000000000000f2f400c138f9fb900576263af0bc7fcde2b1b8a800000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000180000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000f2f400c138f9fb900576263af0bc7fcde2b1b8a8000000000000000000000000646703824cdb020d4e16b278808abb22432eaee000000000000000000000000000000000000000000000000000000045d964b8000000000000000000000000000000000000000000000000000000000218a0996f00000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000014600000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000001c000000000000000000000000000000000000000000000000000000000000002a000000000000000000000000000000000000000000000000000000000000006a00000000000000000000000000000000000000000000000000000000000000f4000000000000000000000000000000000000000000000000000000000000012208000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000064eb5625d9000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480000000000000000000000000a59649758aa4d66e25f08dd01271e891fe5219900000000000000000000000000000000000000000000000000000045d964b8000000000000000000000000000000000000000000000000000000000080000000000000000000000089b78cfa322f6c5de0abceecab66aee45393cc5a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000004495991276000000000000000000000000f2f400c138f9fb900576263af0bc7fcde2b1b8a800000000000000000000000000000000000000000000000000000045d964b800000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000364ad0e7b1a000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000003000000000000000000000000006b175474e89094c44da98b954eedeac495271d0f00000000000000000000000000000032000000000000000000000000000000320000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001408000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000064eb5625d90000000000000000000000006b175474e89094c44da98b954eedeac495271d0f000000000000000000000000a5407eae9ba41422680e2e00537571bcc53efbfd000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000800000000000000000000000a5407eae9ba41422680e2e00537571bcc53efbfd0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000843df0212400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000b2d60fac00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000280000000000000000000000000000000000000000000000000000000000000448000000000000000000000000000000000000000000000000000000000000044000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000804ad0e7b1a000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000007a0000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec700000000000000000000000000000032000000000000000000000000000000320000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001408000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000064eb5625d9000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7000000000000000000000000ba12222222228d8ba445958a75a0704d566bf2c8000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000800000000000000000000000ba12222222228d8ba445958a75a0704d566bf2c8000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000524945bcec90000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000003e0000000000000000000000000f2f400c138f9fb900576263af0bc7fcde2b1b8a80000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f2f400c138f9fb900576263af0bc7fcde2b1b8a8000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004800000000000000000000000000000000000000000000000000000000063407b8100000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000001e02bbf681cc4eb09218bee85ea2a5d3d13fa40fc0c0000000000000000000000fd00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000007b50775383d3d6f0215a8f290f2c9e2eebbeceb20000000000000000000000fe00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000009210f1204b5a24742eba12f710636d76240df3d00000000000000000000000fc00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec70000000000000000000000002bbf681cc4eb09218bee85ea2a5d3d13fa40fc0c0000000000000000000000009210f1204b5a24742eba12f710636d76240df3d0000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000000000000000000000000000000000000047fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffff4d1fccdb0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000028000000000000000000000000000000000000000000000000000000000000044800000000000000000000000000000000000000000000000000000000000020400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000024432ce0a7c00000000000000000000000000000000000000000000000000000000000000808000000000000000000000000000000000000000000000000000000000000044000000000000000000000000f2f400c138f9fb900576263af0bc7fcde2b1b8a800000000000000000000000000000000000000000000000000000000000001c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a405971224000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000646703824cdb020d4e16b278808abb22432eaee00000000000000000000000000000000000000000000000000000000000000001000000000000000002c57546dd026bcd00000000000000000de0b6b3a764000000000000000000000000000000000000000000000000000000000000007a0f2900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004470bdb947000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000000000000000000000000000d19ebbef710000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000016414284aab00000000000000000000000000000000000000000000000000000000000000808000000000000000000000000000000000000000000000000000000000000024000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480000000000000000000000000000000100000000000000000000000000000001000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000044a9059cbb0000000000000000000000001111111254fb6c44bac0bed2854e76f90643097d0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000044095ea7b30000000000000000000000001e0447b19bb6ecfdae1e4ae1694b0c3659614e4e00000000000000000000000000000000000000000000000000000045d964b802000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000045d964b80200000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000646703824cdb020d4e16b278808abb22432eaee0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000"
    //     // const data = "0x472b43f300000000000000000000000000000000000000000000000004db7325476300000000000000000000000000000000000000000000000000000002fce31cb8dc1400000000000000000000000000000000000000000000000000000000000000800000000000000000000000008e8ef5064b02d82da4b7fb207a40bff5ad1de9120000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000002f0f622a93c85c43fd47f4ab119360f5846026c4"
    //     // const data = "0xf0cdf7af000000000000000000000000dd974d5c2e2928dea5f71b9825b8b646686bd2000000000000000000000000006b175474e89094c44da98b954eedeac495271d0f0000000000000000000000000e1212b04daa889686d7e39361ae33d9afa8b79b000000000000000000000000dd974d5c2e2928dea5f71b9825b8b646686bd20000000000000000000000000039c6b3e42d6a679d7d776778fe880bc9487c2eda00000000000000000000000000000000000000000000000000025da2ff13149000000000000000000000000000000000000000000000005e06a3cac5e4685e4b000000000000000000000000000000000000000000000176046c5cf844bb485200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000c2e9f25be6257c210d7adf0d4cd6e3e881ba25f800000000000000000000000000000000000000000000000000000000000001a0000000000000000000000000000000000000000000000000000000000000003ddd974d5c2e2928dea5f71b9825b8b646686bd20076838fd2f22bdc1d3e96069971e65653173edb2a03c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000"
    //     // const data = "0xf0cdf7af000000000000000000000000dd974d5c2e2928dea5f71b9825b8b646686bd2000000000000000000000000006b175474e89094c44da98b954eedeac495271d0f0000000000000000000000000e1212b04daa889686d7e39361ae33d9afa8b79b000000000000000000000000dd974d5c2e2928dea5f71b9825b8b646686bd20000000000000000000000000039c6b3e42d6a679d7d776778fe880bc9487c2eda00000000000000000000000000000000000000000000000000025da2ff13149000000000000000000000000000000000000000000000005e06a3cac5e4685e4b000000000000000000000000000000000000000000000176046c5cf844bb485200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000c2e9f25be6257c210d7adf0d4cd6e3e881ba25f800000000000000000000000000000000000000000000000000000000000001a0000000000000000000000000000000000000000000000000000000000000003ddd974d5c2e2928dea5f71b9825b8b646686bd20076838fd2f22bdc1d3e96069971e65653173edb2a03c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000"
    //     // const data = "0xfb0f3ee100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006663ebe8e0d50000000000000000000000000007d971d2a6dcaac84965d8f9f55e42317b7d0e773000000000000000000000000004c00500000ad104d7dbd00e3ae0a5c00560c0000000000000000000000000028472a58a490c5e09a238847f66a68a47cc76f0f00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000700000000000000000000000000000000000000000000000000000000635659fb00000000000000000000000000000000000000000000000000000000637de6fb0000000000000000000000000000000000000000000000000000000000000000360c6ebe000000000000000000000000000000000000000039e3497a84de9b9f0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f00000000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f00000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000024000000000000000000000000000000000000000000000000000000000000002e00000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000002ece97baea70000000000000000000000000000000a26b00c1f0df003000390027140000faa71900000000000000000000000000000000000000000000000000bb3a5eeba9c00000000000000000000000000081e572fe2d89c5e90f68e7040da372543afbab570000000000000000000000000000000000000000000000000000000000000041c027f75be138625c2cd299cea166b4f9ca91db9c8107d0a65f5e5b12cd514e8242ab7983bb580ca4e0b4415e21d3756daadd6eb1c9f22cf4ec126ff4c28b39191b00000000000000000000000000000000000000000000000000000000000000360c6ebe"
    //     // const data = "0x87201b4100000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000cc00000000000000000000000000000000000000000000000000000000000000ce00000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000adbca1fca05b161f04dff4991801d6c860e71b10000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000052000000000000000000000000000000000000000000000000000000000000005a000000000000000000000000031c55f64cdd0dceb6a3ce2174044ad9350e2c337000000000000000000000000004c00500000ad104d7dbd00e3ae0a5c00560c00000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000002200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000006356932b00000000000000000000000000000000000000000000000000000000637ef8a40000000000000000000000000000000000000000000000000000000000000000360c6ebe0000000000000000000000000000000000000000b25ca48310020e8e0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f000000000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200000000000000000000000061b92f8a016d579ff5e9dd788c5f9c96a791234d00000000000000000000000000000000000000000000000000000000000011d1000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004147f713bf7000000000000000000000000000000000000000000000000000004147f713bf700000000000000000000000000031c55f64cdd0dceb6a3ce2174044ad9350e2c3370000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001dd7c1681d0000000000000000000000000000000000000000000000000000001dd7c1681d0000000000000000000000000000000a26b00c1f0df003000390027140000faa719000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000775f05a074000000000000000000000000000000000000000000000000000000775f05a0740000000000000000000000000003c09cab8c9a43d3c9d3fbd6d554272de1cf310a200000000000000000000000000000000000000000000000000000000000000412e68594be043bf49f032f8cbe46770aca51bd5b9906756806e76c9d7c105379415931ee7078c6dfb5648dbe9be438b8609641c8a19eca126105d82c3af38c2661c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000052000000000000000000000000000000000000000000000000000000000000005a0000000000000000000000000ad47e9d28103d74e94ac5a36ecdbdcc573b5a393000000000000000000000000004c00500000ad104d7dbd00e3ae0a5c00560c00000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000002200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000006356938600000000000000000000000000000000000000000000000000000000637f20820000000000000000000000000000000000000000000000000000000000000000360c6ebe0000000000000000000000000000000000000000a81803d1cf8e8ce20000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f000000000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200000000000000000000000061b92f8a016d579ff5e9dd788c5f9c96a791234d0000000000000000000000000000000000000000000000000000000000000eee0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040f862655478000000000000000000000000000000000000000000000000000040f86265547800000000000000000000000000ad47e9d28103d74e94ac5a36ecdbdcc573b5a3930000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001db3602e528000000000000000000000000000000000000000000000000000001db3602e528000000000000000000000000000000a26b00c1f0df003000390027140000faa71900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000076cd80b94a00000000000000000000000000000000000000000000000000000076cd80b94a0000000000000000000000000003c09cab8c9a43d3c9d3fbd6d554272de1cf310a20000000000000000000000000000000000000000000000000000000000000041be6875c524b99380c972534ce40570c3ae885bffd9dec0917ede80c51d8f4a19449e1be11484ddb6b2c3e60f65d983eacf15e7d0567a555a81b1334fd1f896661b00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000000220000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000072db8c0b"
    //     const data = "0x78e111f6000000000000000000000000b6fb3a8181bf42a89e61420604033439d11a09530000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000018433ef3e6a0000000000000000000000000000000000000000000000000000000062fb6ed900000000000000000000000000000000000000000000000000fe091352dc80f0000000000000000000000000000000000000000000000000000000000000007f00000000000000000000000056178a0d5f301baf6cf3e1cd53d9863437345bf9000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000000000000001857a47ca29a46000000000000000000000000000000000000000000000000001d14a0219e548200000000000000000000000000000000000000000000000000000000000000000070ccc85b0000000000000000000000000000000000000000000000000000000070ccc85b0000000000000000000000000000000000000000000000000de0b6b3a764000000000000000000000000000000000000000000000000009d97172d0297c0000000000000000000000000000000000000000000000000000000000000"; // https://tx.eth.samczsun.com/ethereum/0xb52668345b575b2baedd2801d13b6bac25fc594ec7e8ed1776f47d1200e3ebb9
    //     const guessed = guessFragment(data);
    //     if (!guessed) {
    //         throw new Error("failed to parse");
    //     }

    //     console.log(chunkString(data.substring(10), 64).map((v, i) => i + " => " + v).join("\n"))
    //     console.log(guessed.format())

    //     console.log(defaultAbiCoder.decode(guessed.inputs, "0x" + data.substring(10)));
    // })
});
