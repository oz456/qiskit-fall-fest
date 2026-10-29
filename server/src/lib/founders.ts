// Team names for the Hackathon, each inspired by an Indian founder. 50 unique names; there are fewer than 50 teams.
export const FOUNDERS: { founder: string; team: string }[] = [
  ["Kunal Shah", "CRED-ibility"], ["Falguni Nayar", "Nykaa Knights"], ["Vineeta Singh", "SUGAR Rush"], ["Sameer Nigam", "PhonePe Phantoms"], ["Nithin Kamath", "Zerodha Zenith"],
  ["Harshil Mathur", "Razorpay Raiders"], ["Richa Kar", "Zivame Vanguard"], ["Deepinder Goyal", "Zomato Zealots"], ["Upasana Taku", "MobiKwik Mavens"], ["Bhavish Aggarwal", "Ola Overdrive"],
  ["Suchitra Ella", "Biotech Bharat Squad"], ["Kiran Mazumdar-Shaw", "Biocon Builders"], ["Albinder Dhindsa", "Blinkit Blitz"], ["Byju Raveendran", "BYJU'S Brainwave"], ["Ashneer Grover", "BharatPe Breakers"],
  ["Radhika Aggarwal", "ShopClues Shakers"], ["Lalit Keshre", "Groww Grinders"], ["Harsh Jain", "Dream11 Dynamos"], ["Vijay Shekhar Sharma", "Paytm Pioneers"], ["Sridhar Vembu", "Zoho Zone"],
  ["Girish Mathrubootham", "Freshworks Flyers"], ["Dheeraj Pandey", "Nutanix Ninjas"], ["Suresh Sambandam", "Kissflow Krew"], ["Kunal Bahl", "Snapdeal Sprinters"], ["Binny Bansal", "Flipkart Flyers"],
  ["Vidit Aatrey", "Meesho Movers"], ["Sujeet Kumar", "Udaan Uprising"], ["Kaivalya Vohra", "Zepto Zoomers"], ["Naveen Tewari", "InMobi Icons"], ["Mukesh Bansal", "Myntra Mission"],
  ["Ankit Nagori", "Cult.fit Crew"], ["Yashish Dahiya", "PolicyBazaar Pulse"], ["Deep Kalra", "MakeMyTrip Trailblazers"], ["Phanindra Sama", "redBus Rebels"], ["Rahul Yadav", "Housing Hustlers"],
  ["Ambareesh Murty", "Pepperfry Pioneers"], ["Pavan Guntupalli", "Rapido Riders"], ["Narayana Murthy", "Infosys Icons"], ["Azim Premji", "Wipro Warriors"], ["Shiv Nadar", "HCL Hustle"],
  ["Nandan Nilekani", "Aadhaar Architects"], ["Aman Gupta", "boAt Brigade"], ["Sabeer Bhatia", "Hotmail Heroes"], ["Avnish Bajaj", "Baazee Bandits"], ["Ravi Kumar", "Upstox Unit"],
  ["Ashish Rajpal", "5paisa Force"], ["Bipin Preet Singh", "Jupiter Jets"], ["Rajan Anandan", "Endiya Energizers"], ["Prasanna Sankar", "Rippling Renegades"], ["Vinod Khosla", "Khosla Ventures Vanguard"],
].map(([founder, team]) => ({ founder: founder!, team: team! }));

// Used only when the 50 above are all taken (there turned out to be more than 50 teams).
export const RESERVE: { founder: string; team: string }[] = [
  ["Ritesh Agarwal", "OYO Originals"], ["Ghazal Alagh", "Mamaearth Mavericks"], ["Peyush Bansal", "Lenskart Legends"], ["Shashank ND", "Practo Pathfinders"], ["Sachin Bansal", "Navi Navigators"],
  ["Gaurav Munjal", "Unacademy Underdogs"], ["Divyank Turakhia", "Media.net Mavericks"], ["Bhavin Turakhia", "Zeta Zeniths"], ["Sanjeev Bikhchandani", "Naukri Navigators"], ["Alakh Pandey", "PhysicsWallah Wizards"],
  ["Anupam Mittal", "Shaadi Strikers"], ["Vishal Gondal", "GOQii Gladiators"], ["Kishore Biyani", "Big Bazaar Brigade"], ["Dhirubhai Ambani", "Reliance Rockets"], ["Verghese Kurien", "Amul Achievers"],
  ["Sairee Chahal", "SHEROES Strikers"], ["Vani Kola", "Kalaari Knights"], ["Shradha Sharma", "YourStory Spartans"], ["Radhakishan Damani", "DMart Dynamos"], ["Vikram Sarabhai", "ISRO Innovators"],
  ["Jamsetji Tata", "Tata Titans"], ["Ashish Hemrajani", "BookMyShow Blasters"], ["Pranay Chulet", "Quikr Quest"], ["Sandeep Aggarwal", "Droom Drivers"], ["Abhiraj Singh Bhal", "Urban Co Unicorns"],
  ["Sahil Barua", "Delhivery Dispatch"],
].map(([founder, team]) => ({ founder: founder!, team: team! }));
