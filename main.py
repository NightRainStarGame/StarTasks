# RongYouXueTang Automation Script
# Description: Automates course video watching on the RongYouXueTang platform
# Original author: UltramarineW from HIT
# Modified by: WuYu He from USTB
# Last updated: 2026-5-5
# This script is for educational purposes only. Use at your own risk.

import tqdm
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from time import sleep
import time
import ddddocr

# 读取账号信息
username = "U202643579"  # 请在此处输入你的账号
password = "ustb@643579"  # 请在此处输入你的密码
school_code = "4111010008"  # 学校代码

# 支持的学校列表
SCHOOLS = {
    "4111010002": "中国人民大学",
    "4111010019": "中国农业大学",
    "4111010048": "中央戏剧学院",
    "4161010719": "延安大学",
    "4145011773": "广西职业技术学院",
    "4145013522": "广西现代职业技术学院",
    "4132010287": "南京航空航天大学",
    "10000119999": "机械工程学院",
    "4145011546": "广西科技师范学院",
    "4145011355": "南宁职业技术学院",
    "4145013831": "广西电力职业技术学院",
    "2022112405": "南宁师范大学",
    "4123012911": "哈尔滨职业技术大学",
    "4111010036": "对外经济贸易大学",
    "4111010007": "北京理工大学",
    "4111010027": "北京师范大学",
    "4123018213": "哈尔滨工业大学（深圳）",
    "4111010032": "北京语言大学",
    "999999999": "济宁技师学院",
    "4111010047": "中央美术学院",
    "4145010595": "桂林电子科技大学",
    "4145014313": "广西卫生职业技术学院",
    "2022112403": "广西职业师范学院",
    "4111010008": "北京科技大学",
    "4111011232": "北京信息科技大学",
    "10000109999": "石家庄机械工程学院",
    "4131010251": "华东理工大学",
    "4111010006": "北京航空航天大学",
    "4111011413": "中国矿业大学（北京）",
    "4111010012": "北京服装学院",
    "4151010610": "四川大学",
    "4111010026": "北京中医药大学",
    "4153010674": "昆明理工大学",
    "4111010052": "中央民族大学",
    "4111010034": "中央财经大学",
    "4145010593": "广西大学",
    "4145012364": "广西工业职业技术学院",
    "4145012379": "广西国际商务职业技术学院",
    "4145013138": "广西建设职业技术学院",
    "4113010216": "燕山大学",
    "99999": "网上注册",
    "4123010217": "哈尔滨工程大学",
    "4145010602": "广西师范大学",
    "4145011837": "桂林旅游学院",
    "4145011350": "广西体育高等专科学校",
    "4145011671": "桂林师范高等专科学校",
    "4145012104": "柳州职业技术学院",
    "4137011066": "烟台大学",
    "4111010013": "北京邮电大学",
    "4111010004": "北京交通大学",
    "4144013177": "北京师范大学珠海校区",
    "4111010040": "外交学院",
    "4111010030": "北京外国语大学",
    "4145010867": "广西机电职业技术学院",
    "4145012392": "柳州铁道职业技术学院",
    "2022112404": "广西开放大学",
    "4123010213": "哈尔滨工业大学",
    "4132010288": "南京理工大学",
    "4111010015": "北京印刷学院",
    "4131010254": "上海海事大学",
    "4131010264": "上海海洋大学",
    "4137011065": "青岛大学",
    "4141010459": "郑州大学",
    "4145011608": "广西水利电力职业技术学院",
    "4145012356": "广西交通职业技术学院",
    "4145013827": "广西经贸职业技术学院",
    "4145013828": "广西工商职业技术学院",
    "2022112401": "广西农业职业技术大学",
    "2022112402": "广西幼儿师范高等专业学校",
    "4111012453": "中国劳动关系学院"
}

debug = 0
already_learned_course = []

# setup driver
options = webdriver.EdgeOptions()
options.add_experimental_option("detach", True)
options.add_argument("--mute-audio")
driver = webdriver.Edge(options=options)
driver.maximize_window()


# 处理验证码 调用ddddocr的api
def handleCaptcha():
    try:
        operation = True
        counter = 0
        while operation:
            if counter > 5:
                operation = False
            WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.ID, 'yzmmsg_xh'))
            )
            yzmmsg = driver.find_element(By.ID, 'yzmmsg_xh')
            # save captcha for classification
            try:
                yzmmsg.screenshot('./save.png')
            except Exception as e:
                print('验证码截图失败')
                counter += 1
                print(e)
                continue
            ocr = ddddocr.DdddOcr(show_ad=False)
            with open('./save.png', 'rb') as f:
                img_bytes = f.read()
                res = ocr.classification(img_bytes)
            f.close()
            print(f'验证码:{res}')
            driver.find_element(By.ID, 'xhYzm').send_keys(res)
            driver.find_element(By.ID, 'login_zsxh').click()
            counter = counter + 1
            sleep(1)
            operation = False

    except Exception as e:
        print('验证码处理失败')
        print(e)


def loginAccount():
    if username == '' or password == '':
        print('请编辑main.py文件并输入对应的账号和密码')
        exit(-1)
    sleep(1)
    
    # 点击"学号登录"按钮
    try:
        # 根据提供的HTML元素信息，使用XPath定位"学号登录"链接
        xh_login = driver.find_element(By.XPATH, "//a[contains(text(), '学号登录')]")
        xh_login.click()
        print("已点击'学号登录'按钮")
        sleep(1)  # 等待界面切换
    except Exception as e:
        print("未找到'学号登录'按钮:", e)
    
    
    # 选择学校
    WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.ID, 'bjssxy'))
    )
    # 使用Select类处理下拉菜单
    from selenium.webdriver.support.ui import Select
    school_select = Select(driver.find_element(By.ID, 'bjssxy'))
    school_select.select_by_value(school_code)  # 选择学校代码
    print(f"已选择'{SCHOOLS.get(school_code, '未知学校')}'")
    
    sleep(1)  # 等待选择生效
    driver.find_element(By.ID, 'usercode_zsxh').send_keys(username)
    driver.find_element(By.ID, 'password_zsxh').send_keys(password)
    handleCaptcha()


def findCourse():
    try:
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CLASS_NAME, 'styu-b-r'))
        )
        class_div = driver.find_element(By.CLASS_NAME, 'styu-b-r')
        # print(f'class_div {class_div}')
        class_div.find_element(By.XPATH, './a[1]').click()
    except Exception as e:
        print('查找<继续学习>失败')
        print(e)


def getContent():
    try:
        left_side = driver.find_element(By.XPATH, '/html/body/div[12]/div[2]/div/div[1]/div[1]')
        course_list = left_side.find_elements(By.TAG_NAME, 'dd')
        return course_list

    except Exception as e:
        print('获取目录失败')
        print(e)


def playVideo(course):
    try:
        print()
        print('Current learning ', course.text.replace('\n', ' '))
        tag = course.find_element(By.TAG_NAME, 'a')
        tag.click()
        sleep(2)
    # 【核心修复1】: 拦截非视频板块，找不到iframe直接当作已完成跳过，防止死循环
        try:
            iframe_node = driver.find_element(By.NAME, 'zwshow')
            driver.switch_to.frame(iframe_node)
        except Exception:
            print("未找到视频播放区域（可能是纯文本、测验或非视频板块），标记为跳过。")
            return True


        # 获取该课程中所有视频的数量
        video_count = 0
        video_index = 1
        
        # 先检查有多少个视频
        while True:
            try:
                # 检查是否存在下一个视频索引
                WebDriverWait(driver, 3).until(
                    EC.presence_of_element_located((By.ID, f'sp_index_{video_index}'))
                )
                video_count += 1
                video_index += 1
            except:
                break
        #增强代码健壮性
        if video_count == 0:
            print("⚠️ 本章节无可用视频，标记为跳过。")
            return True

        print(f"本节课共有 {video_count} 个视频")
        
        # 处理所有视频
        for video_index in range(1, video_count + 1):
            # 检查此视频是否已完成
            tag = driver.find_element(By.ID, f'sp_index_{video_index}')
            if tag.text == '已完成':
                print(f'视频 {video_index}/{video_count} 已完成，跳过')
                continue
                
            print(f'开始播放视频 {video_index}/{video_count}')
            
            # 点击视频封面中的开始图片
            WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.ID, f"myVideoImg_{video_index}"))
            )
            
            # 尝试多种方法点击视频播放按钮
            try:
                # 方法1：通过onclick属性查找播放按钮
                play_button = WebDriverWait(driver, 5).until(
                    EC.element_to_be_clickable((By.CSS_SELECTOR, f"#myVideoImg_{video_index} a[onclick*='videoclick']"))
                )
                print(f"找到视频 {video_index} 播放按钮(通过onclick属性)")
                driver.execute_script("arguments[0].click();", play_button)
            except Exception as e1:
                print(f"方法1查找视频 {video_index} 播放按钮失败:", e1)
                try:
                    # 方法2：通过ID和子元素定位
                    video_img = driver.find_element(By.ID, f'myVideoImg_{video_index}')
                    play_button = video_img.find_element(By.TAG_NAME, 'a')
                    print(f"找到视频 {video_index} 播放按钮(通过myVideoImg_{video_index})")
                    driver.execute_script("arguments[0].click();", play_button)
                except Exception as e2:
                    print(f"方法2查找视频 {video_index} 播放按钮失败:", e2)
                    # 方法3：尝试获取spdm值并调用videoclick函数
                    try:
                        # 尝试从spdm属性获取视频ID
                        spdm_element = driver.find_element(By.CSS_SELECTOR, f"div[videoid='myVideo_{video_index}']")
                        spdm_value = spdm_element.get_attribute("spdm")
                        print(f"尝试使用JavaScript直接调用videoclick函数，spdm={spdm_value}")
                        driver.execute_script(f"videoclick(null, '{spdm_value}')")
                    except Exception as e3:
                        print(f"所有方法尝试失败，无法播放视频 {video_index}:", e3)
                        continue
            
            print(f"视频 {video_index} 开始播放")

            # 找到视频元素
            WebDriverWait(driver, 10).until((
                EC.presence_of_element_located((By.ID, f"myVideo_{video_index}"))
            ))
            video = driver.find_element(By.ID, f"myVideo_{video_index}")
            url = driver.execute_script("return arguments[0].currentSrc;", video)
            print(f"视频 {video_index} URL: {url}")

            # 获取播放视频的时间
            duration_time = driver.execute_script("return arguments[0].duration", video)
            current_time = driver.execute_script("return arguments[0].currentTime", video)
            print(f'视频 {video_index}: current_time: {current_time}, duration_time: {duration_time}')

            # tqdm进度条
            pbar = tqdm.tqdm(total=duration_time)
            while current_time < duration_time - 0.5:  # 允许0.5秒误差
                last_time = current_time
                current_time = driver.execute_script("return arguments[0].currentTime", video)
                sleep(1)
                pbar.update(current_time - last_time)
            pbar.close()

            # 验证视频是否已完成
            tag = driver.find_element(By.ID, f'sp_index_{video_index}')
            print(f"视频 {video_index} 完成状态: {tag.text}")
            
        # 检查是否所有视频都已完成
        all_completed = True
        for video_index in range(1, video_count + 1):
            tag = driver.find_element(By.ID, f'sp_index_{video_index}')
            if tag.text != '已完成':
                all_completed = False
                break
        
        if all_completed:
            print('本节课所有视频已学完')
            already_learned_course.append(course.text)
            return True
        else:
            print('本节课还有未完成的视频')
            return False

    except Exception as e:
        print("播放视频失败")
        print(e)
        return False


def judgeExist(element, by, value):
    try:
        element.find_element(by=by, value=value)

    except Exception as e:
        return False
    return True


def chooseCourse(course_list):
    already_learned = []
    not_learned = []
    learning = []
    skipped_tests = 0

    for course in course_list:
        try:
            # 过滤掉不需要刷的板块
            course_text = course.text.lower()
            if any(kw in course_text for kw in ["单元测试", "测试", "考试", "测验", "作业", "讨论", "期末"]):
                skipped_tests += 1
                continue
        except:
            pass

        # 根据图标 ID 判断状态
        if judgeExist(course, By.ID, 'a'): # 已完成图标
            already_learned.append(course)
        elif judgeExist(course, By.ID, 'r') or judgeExist(course, By.ID, 'f'): # 未完成/正在进行图标
            # 排除掉本轮运行中已经刷过的缓存
            if course.text in already_learned_course:
                already_learned.append(course)
                continue
            not_learned.append(course)
        else:
            learning.append(course)

    # 🚨 修正重点：将 print 和 return 移出 for 循环 🚨
    # 这样程序才会扫描完所有章节再做决定
    print(f'📊 扫描结果 -> 未学:{len(not_learned)} | 已学:{len(already_learned)} | 跳过非视频点:{skipped_tests}')
    return not_learned

def startPlay():
    try:
        while True:
            course_list = getContent()
            not_learned = chooseCourse(course_list)

            #【核心修复3】：先判断列表是否为空，避免list index out of range
            if len(not_learned) == 0:
                print("本门课程的所有可播放章节已处理完毕！")
                break

            course_name = not_learned[0].text
            played = playVideo(not_learned[0])

            if played:
                already_learned_course.append(course_name)

            driver.refresh()
            sleep(2)#给页面缓冲时间
    except Exception as e:
        print('播放失败')
        print(e)

def closeLoginPopup():
    """关闭登录成功后的弹窗"""
    try:
        # 等待弹窗出现
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CLASS_NAME, 'popup-main-xq'))
        )
        # 找到并点击关闭按钮
        close_button = driver.find_element(By.CLASS_NAME, 'popup-main-xq')
        close_button.click()
        print("已关闭登录成功弹窗")
        sleep(1)  # 给页面一些时间响应点击操作
    except Exception as e:
        print("关闭弹窗失败或弹窗不存在:", e)



#【核心修复4】：新增跨课程遍历控制器 (修复 Timeout 崩溃版)
def processAllCourses():
    course_index = 0
    while True:
        print(f"\n======================================")
        print(f"正在尝试前往 '我的课程' 寻找第 {course_index + 1} 门课...")
        print(f"======================================")

        # --- 修复 TimeoutError：增加超时控制和异常捕获 ---
        try:
            # 限制页面加载时间为 30 秒，防止无限卡死报错
            driver.set_page_load_timeout(30)
            driver.get('https://cumtb.livedu.com.cn/ispace4.0/moocMainIndex/mainIndex.do')
        except Exception as e:
            print("⚠️ 页面加载超时，尝试强制停止加载以继续运行...")
            try:
                # 如果 30 秒还没加载完，强制让浏览器停止转圈
                driver.execute_script("window.stop();")
            except:
                pass
        sleep(3)
        # -------------------------------------------------

        # 方法1：使用强化版 JavaScript 穿透寻找并点击“我的课程”
        try:
            js_script = """
            var els = document.querySelectorAll('a, li, span, div');
            for (var i = 0; i < els.length; i++) {
                if (els[i].textContent.trim() === '我的课程') {
                    els[i].click();
                    return true;
                }
            }
            return false;
            """
            jump_success = driver.execute_script(js_script)
            if jump_success:
                print("✅ 代码成功点击了'我的课程'")
                sleep(3)
        except Exception as e:
            pass

        if len(driver.window_handles) > 1:
            driver.switch_to.window(driver.window_handles[-1])

        # 方法2（终极兜底）：手动辅助
        try:
            WebDriverWait(driver, 5).until(
                EC.presence_of_element_located((By.XPATH, "//*[contains(text(), '继续学习')]"))
            )
        except:
            print("\n⚠️ 自动寻找入口失败。")
            print("👉 请在打开的浏览器中，手动点击右上角头像旁的【我的课程】！")
            print("⏳ 脚本正在等待您的手动操作 (最多等待30秒)...")
            try:
                WebDriverWait(driver, 30).until(
                    EC.presence_of_element_located((By.XPATH, "//*[contains(text(), '继续学习')]"))
                )
                print("✅ 检测到您已进入课程列表页，脚本重新接管！")
            except:
                print("❌ 超时未检测到课程列表，脚本结束。")
                break

        # --- 成功进入列表页后，开始寻找课程并点击进去 ---
        try:
            continue_btns = driver.find_elements(By.XPATH, "//*[contains(text(), '继续学习')]")

            if course_index >= len(continue_btns):
                print("\n🎉🎉 所有课程已遍历处理完毕，脚本圆满结束！ 🎉🎉")
                break

            print(f"👉 成功找到课程，即将自动进入第 {course_index + 1} 门课...")
            driver.execute_script("arguments[0].click();", continue_btns[course_index])
            sleep(4)

            if len(driver.window_handles) > 1:
                driver.switch_to.window(driver.window_handles[-1])

            global already_learned_course
            already_learned_course = []

            # 开始刷课
            startPlay()

        except Exception as e:
            print(f"处理第 {course_index + 1} 门课时发生错误: {e}")

        course_index += 1

        # --- 修复 TimeoutError：更稳定安全的标签页关闭逻辑 ---
        try:
            handles = driver.window_handles
            # 保留第一个主窗口（handles[0]），关闭后面新开的所有窗口
            for i in range(1, len(handles)):
                driver.switch_to.window(handles[i])
                driver.close()
            # 强制稳妥地切回主窗口
            driver.switch_to.window(handles[0])
        except Exception as e:
            print(f"清理标签页时发生异常，尝试恢复: {e}")
            try:
                driver.switch_to.window(driver.window_handles[0])
            except:
                pass
        # -----------------------------------------------------

if __name__ == '__main__':
    # 1. 刚启动时给够时间，设为 60 秒（比中间循环时宽容一些）
    driver.set_page_load_timeout(60)

    print("🚀 正在打开主页，请稍候...")
    try:
        driver.get('https://cumtb.livedu.com.cn/ispace4.0/moocMainIndex/mainIndex.do')
    except Exception:
        print("⚠️ 页面加载较慢，强行中断加载并尝试继续...")
        driver.execute_script("window.stop();")

    # 2. 🚨 关键修复：强制等待 5 秒，确保网页就算被 stop 了，主要的按钮也能渲染出来
    sleep(5)

    login_time_start = time.time()

    # 检查登录按钮
    dengl_btn = driver.find_elements(By.CLASS_NAME, 'header-dengl')
    if len(dengl_btn) > 0:
        print("👉 检测到需要登录，正在执行登录流程...")
        dengl_btn[0].click()
        loginAccount()
        print(f'🎉 成功登录, 耗时: {time.time() - login_time_start:.2f}s')
        closeLoginPopup()
        sleep(3)  # 登录完成后给页面一点缓冲时间
    else:
        print('✅ 未检测到“登录”按钮，当前处于已登录状态。')

    # 启动控制器
    processAllCourses()
