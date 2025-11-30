fileName=input("输入VSC文件名")
offset=float(input("输入移动距离(ms)"))
output=[]
with open(fileName,"r+") as f:
    for ln in f.readlines():
        noteInfoList=ln.split(',')
        if noteInfoList[1]=='3':
            continue
        noteInfoList=str(round(float(noteInfoList[0])+offset,5))
        newLn=','.join(noteInfoList)
        output.append(newLn)
    f.writelines(output)
